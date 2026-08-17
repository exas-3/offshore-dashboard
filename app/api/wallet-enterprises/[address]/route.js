export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db/connection.js';

// On-chain item/loadout manager. Hosts getInventory, getUserGenerators,
// getEquippedItems, getItem, etc. — verified empirically against the game
// frontend's contract calls.
const MGR = '0x1b5ab7c503c2b1d94e7c42b212b4f944f7c77fce';
const RPC = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.megaeth.com/rpc';

// Pre-computed 4-byte selectors (keccak256 prefix).
const SEL_USER_GENERATORS = '0x9f3381e2'; // getUserGenerators(address)
const SEL_GET_INVENTORY   = '0x8b87c544'; // getInventory(address)
const SEL_EQUIPPED        = '0xe1cb4148'; // getEquippedItems(uint256)
const SEL_GET_ITEM        = '0x3129e773'; // getItem(uint256)

const SLOT_NAMES = {
  1: 'Business', 2: 'Insurance', 3: 'Accountant',
  4: 'Method',   5: 'Associates', 6: 'OpSec',
};

const RARITY_NAMES = ['common', 'common', 'rare', 'epic', 'legendary'];

async function rpcCall(data, attempt = 0) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: MGR, data }, 'latest'] }),
  });
  if (!r.ok && attempt < 2) {
    await new Promise(r => setTimeout(r, 1000));
    return rpcCall(data, attempt + 1);
  }
  const j = await r.json();
  if (j.error) return null;
  return j.result;
}

function padAddr(addr)  { return addr.slice(2).toLowerCase().padStart(64, '0'); }
function padUint(n)     { return BigInt(n).toString(16).padStart(64, '0'); }

function decodeUintArray(hex) {
  if (!hex || hex.length < 130) return [];
  const data = hex.slice(2);
  const len  = parseInt(data.slice(64, 128), 16);
  const out  = [];
  for (let i = 0; i < len; i++) {
    out.push(BigInt('0x' + data.slice(128 + i * 64, 192 + i * 64)));
  }
  return out;
}

function decodeUintFixed(hex, n) {
  // For uint256[N] return — no length prefix, just N values
  if (!hex || hex.length < 2 + n * 64) return [];
  const data = hex.slice(2);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(BigInt('0x' + data.slice(i * 64, (i + 1) * 64)));
  }
  return out;
}

function decodeItem(hex) {
  if (!hex || hex.length < 2 + 64 * 3) return null;
  const data = hex.slice(2);
  return {
    templateId: parseInt(data.slice(0, 64), 16),
    rarity:     parseInt(data.slice(64, 128), 16),
    owner:      '0x' + data.slice(128 + 24, 128 + 64),
  };
}

import { guardDemoDisabled } from '../../../../lib/api-guard.js';

export async function GET(_req, { params }) {
  const blocked = guardDemoDisabled();
  if (blocked) return blocked;
  try {
    const address = params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) {
      return NextResponse.json({ error: 'invalid address' }, { status: 400 });
    }

    // 1. Inventory (every item the user owns, equipped or not)
    const invHex = await rpcCall(SEL_GET_INVENTORY + padAddr(address));
    const inventoryIds = decodeUintArray(invHex);

    // 2. User's generators (loadouts)
    const ugHex = await rpcCall(SEL_USER_GENERATORS + padAddr(address));
    const generatorIds = decodeUintArray(ugHex);

    // 3. For each generator, get its 6 equipped slots (uint256[6])
    const equipped = await Promise.all(generatorIds.map(async (genId) => {
      const hex = await rpcCall(SEL_EQUIPPED + padUint(genId));
      const slots = decodeUintFixed(hex, 6);
      return { generatorId: genId.toString(), slots: slots.map(s => s.toString()) };
    }));

    // 4. Resolve every referenced item (inventory + equipped) to its details
    const itemIdSet = new Set();
    for (const id of inventoryIds) itemIdSet.add(id.toString());
    for (const g of equipped) for (const s of g.slots) if (s !== '0') itemIdSet.add(s);

    const itemDetailsArr = await Promise.all([...itemIdSet].map(async (id) => {
      const hex = await rpcCall(SEL_GET_ITEM + padUint(id));
      return [id, decodeItem(hex)];
    }));
    const itemMap = new Map(itemDetailsArr);

    // 5. Join templates against game_items for slot/name/city
    const templateIds = [...new Set([...itemMap.values()].filter(Boolean).map(i => i.templateId))];
    const templateRows = templateIds.length
      ? await getDb()`
          SELECT g.id, g.item_name, g.item_type_id, g.specific_location AS city, g.region,
                 l.flag_emoji
          FROM game_items g
          LEFT JOIN game_locations l ON l.city = g.specific_location
          WHERE g.id = ANY(${templateIds})`
      : [];
    const templateMap = new Map(templateRows.map(r => [r.id, r]));

    const enrichItem = (id) => {
      const it = itemMap.get(String(id));
      if (!it) return null;
      const tpl = templateMap.get(it.templateId);
      return {
        itemId:    String(id),
        templateId: it.templateId,
        rarity:    it.rarity,
        rarityName: RARITY_NAMES[it.rarity] || `r${it.rarity}`,
        name:      tpl?.item_name || `template #${it.templateId}`,
        slot:      tpl ? SLOT_NAMES[tpl.item_type_id] : null,
        slotIdx:   tpl?.item_type_id ?? null,
        city:      tpl?.city  || null,
        region:    tpl?.region || null,
        flag:      tpl?.flag_emoji || null,
      };
    };

    return NextResponse.json({
      address,
      inventoryCount: inventoryIds.length,
      generatorCount: generatorIds.length,
      generators: equipped.map(g => ({
        generatorId: g.generatorId,
        slots: g.slots.map((s, idx) => ({
          slotIdx: idx + 1,
          slot:    SLOT_NAMES[idx + 1],
          item:    s === '0' ? null : enrichItem(s),
        })),
      })),
      inventory: [...inventoryIds].map(id => enrichItem(id.toString())).filter(Boolean),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
