import { JSONParser } from '@streamparser/json';
import type { Frame, Recording } from './types';

export interface ReplayBatch {
  meta?: Recording['meta'];
  terrain?: Recording['terrain'];
  frames: Frame[];
  done: boolean;
  error?: string;
}

// Runs in a worker. Emit completed frames without retaining a second recording
// in the parser, and await each delivery so messages cannot pile up in the UI.
export async function readReplay(
  response: Response,
  deliver: (batch: ReplayBatch) => Promise<void>,
) {
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  if (!response.body) throw new Error('Replay streaming is unavailable.');
  const parser = new JSONParser({ paths: ['$.meta', '$.terrain', '$.frames.*'], keepStack: false });
  let meta: Recording['meta'];
  let terrain: Recording['terrain'];
  let frames: Frame[] = [];
  let first = true;
  let lastDelivery = 0;
  let frameCount = 0;
  parser.onValue = ({ key, value }) => {
    if (key === 'meta') meta = value as unknown as Recording['meta'];
    else if (key === 'terrain') terrain = value as Recording['terrain'];
    else {
      const frame = value as unknown as Frame;
      if (!frame || !Array.isArray(frame.objects)) throw new Error('Invalid replay frame.');
      frames.push(frame);
      frameCount++;
    }
  };
  const flush = async (done: boolean) => {
    if (!meta || !terrain) throw new Error('Replay metadata or terrain is missing.');
    const batch: ReplayBatch = { frames, done };
    if (first) { batch.meta = meta; batch.terrain = terrain; }
    frames = [];
    first = false;
    await deliver(batch);
    lastDelivery = performance.now();
  };
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Bound individual parse/message batches even if fetch coalesces reads.
      for (let offset = 0; offset < value.length; offset += 64 * 1024) {
        parser.write(value.subarray(offset, offset + 64 * 1024));
        if (frames.length && meta && terrain && (first || frames.length >= 128 || performance.now() - lastDelivery >= 100)) {
          await flush(false);
        }
      }
    }
    if (!parser.isEnded) parser.end();
    if (!frameCount) throw new Error('This replay contains no frames.');
    await flush(true);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
