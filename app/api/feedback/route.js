export const runtime = 'nodejs';
import { NextResponse } from 'next/server';

// Credentials live in .env (TG_BOT_TOKEN / TG_CHAT_ID) — never in source:
// this repo is public and the previous hardcoded token had to be rotated.

const MAX_LEN = 4000; // Telegram sendMessage hard limit is 4096

// Naive in-memory rate limit: 5 posts/min per IP + 20/min globally. Keyed on
// the RIGHTMOST x-forwarded-for hop (the one the fronting proxy appended —
// the leftmost is attacker-controlled and would make the limit spoofable).
const _hits = new Map(); // ip → [timestamps]
const _global = [];
function rateLimited(ip) {
  const now = Date.now();
  while (_global.length && now - _global[0] > 60_000) _global.shift();
  if (_global.length >= 20) return true;
  const arr = (_hits.get(ip) || []).filter(t => now - t < 60_000);
  if (arr.length >= 5) { _hits.set(ip, arr); return true; }
  arr.push(now);
  _global.push(now);
  _hits.set(ip, arr);
  if (_hits.size > 5000) {
    // Prune stale keys (never clear() — that would reset active limits too).
    for (const [k, v] of _hits) if (!v.some(t => now - t < 60_000)) _hits.delete(k);
  }
  return false;
}

export async function POST(req) {
  try {
    const token  = process.env.TG_BOT_TOKEN;
    const chatId = process.env.TG_CHAT_ID;
    if (!token || !chatId) return NextResponse.json({ error: 'feedback disabled' }, { status: 503 });

    const xff = req.headers.get('x-forwarded-for');
    const ip = xff ? xff.split(',').at(-1).trim() : 'unknown';
    if (rateLimited(ip)) return NextResponse.json({ error: 'slow down' }, { status: 429 });

    const len = Number(req.headers.get('content-length'));
    if (!Number.isFinite(len) || len > 16_384) {
      return NextResponse.json({ error: 'payload too large' }, { status: 413 });
    }

    const { subject, message } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const text = [
      '💬 *New Feedback*',
      subject?.trim() ? `*Subject:* ${subject.trim().slice(0, 200)}` : null,
      `*Message:*\n${message.trim().slice(0, MAX_LEN)}`,
    ].filter(Boolean).join('\n\n');

    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });

    const data = await r.json();
    if (!data.ok) return NextResponse.json({ error: data.description }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
