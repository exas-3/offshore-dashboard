export const runtime = 'nodejs';
import { ethPriceFeed } from '../../../../lib/eth-price-feed.js';
import { DEMO_MODE } from '../../../../lib/demo-clock.js';

export async function GET() {
  // Demo: no live feed exists; close immediately (no known consumers).
  if (DEMO_MODE) return new Response(null, { status: 204 });
  const encoder = new TextEncoder();
  let unsub;

  const stream = new ReadableStream({
    start(controller) {
      const send = (price) => {
        try {
          controller.enqueue(encoder.encode(`data: ${price}\n\n`));
        } catch { unsub?.(); }
      };

      // Send immediately if we have a price
      const initial = ethPriceFeed.getLatest();
      if (initial != null) send(initial);

      ethPriceFeed.subscribe(send);
      unsub = () => ethPriceFeed.unsubscribe(send);
    },
    cancel() { unsub?.(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
