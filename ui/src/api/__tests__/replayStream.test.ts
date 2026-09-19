import { describe, expect, it } from 'vitest';
import { readReplay, type ReplayBatch } from '../replayStream';

const header = '{"meta":{"scenario":"test","ticks":1},"terrain":{},"frames":[';
const frame = (gameTime: number) => JSON.stringify({ gameTime, objects: [], flags: [], console: ['café 🐛 "quoted"'] });
const encode = (text: string) => new TextEncoder().encode(text);

describe('progressive replay loading', () => {
  it('delivers playable frames before EOF and waits for the consumer', async () => {
    let source: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
    const batches: ReplayBatch[] = [];
    let acknowledge: () => void;
    let firstBatch: () => void;
    const ready = new Promise<void>(resolve => { firstBatch = resolve; });
    const loading = readReplay(new Response(body), async batch => {
      batches.push(batch);
      if (batches.length === 1) {
        firstBatch();
        await new Promise<void>(resolve => { acknowledge = resolve; });
      }
    });
    source!.enqueue(encode(header + frame(0)));
    await ready;
    expect(batches[0].frames[0].gameTime).toBe(0);
    expect(batches[0].done).toBe(false);
    expect(batches[0].meta.scenario).toBe('test');
    source!.enqueue(encode(',' + frame(1) + ']}'));
    source!.close();
    expect(batches).toHaveLength(1);
    acknowledge!();
    await loading;
    expect(batches.flatMap(batch => batch.frames).map(f => f.gameTime)).toEqual([0, 1]);
    expect(batches[batches.length - 1].done).toBe(true);
  });

  it('handles UTF-8 and JSON tokens split across individual bytes', async () => {
    const bytes = encode(header + frame(0) + ',' + frame(1) + ']}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const batches: ReplayBatch[] = [];
    await readReplay(new Response(body), async batch => { batches.push(batch); });
    expect(batches.flatMap(batch => batch.frames).map(f => f.console[0])).toEqual(['café 🐛 "quoted"', 'café 🐛 "quoted"']);
  });

  it('does not report truncated or empty recordings as complete', async () => {
    const batches: ReplayBatch[] = [];
    await expect(readReplay(new Response(header + frame(0)), async batch => { batches.push(batch); })).rejects.toThrow();
    expect(batches.some(batch => batch.done)).toBe(false);
    await expect(readReplay(new Response(header + ']}'), async () => {})).rejects.toThrow('no frames');
  });
});
