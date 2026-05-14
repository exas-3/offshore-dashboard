export const runtime = 'nodejs';
import { NextResponse } from 'next/server';

const BOT_TOKEN = '8225310864:AAFJV0B29b1A7W5e2nFWDpnm5c94H68VRcY';
const CHAT_ID   = '381558565';

export async function POST(req) {
  try {
    const { subject, message } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const text = [
      '💬 *New Feedback*',
      subject?.trim() ? `*Subject:* ${subject.trim()}` : null,
      `*Message:*\n${message.trim()}`,
    ].filter(Boolean).join('\n\n');

    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
    });

    const data = await r.json();
    if (!data.ok) return NextResponse.json({ error: data.description }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
