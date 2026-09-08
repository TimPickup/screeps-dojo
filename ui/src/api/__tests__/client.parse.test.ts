import { describe, it, expect, afterEach } from 'vitest';
import { jget, NATIVE_PARSE_LIMIT } from '../client';

// jget() picks its JSON parser by the response's declared size: the engine's own
// parser below the string limit, a streaming one above it. These cover the choice
// itself, because the two paths are only equivalent when they agree — and the
// streaming one is several times slower, so taking it by accident is the bug.

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function respond(body: string, headers: Record<string, string>, init: ResponseInit = {}) {
  globalThis.fetch = (async () => new Response(body, { ...init, headers })) as typeof fetch;
}

// A response whose body stream is unreachable. Only the native path can read it,
// so succeeding here proves the streaming path was not taken.
function respondNativeOnly(body: string, contentLength: string) {
  globalThis.fetch = (async () => {
    const res = new Response(body, { headers: { 'content-length': contentLength } });
    Object.defineProperty(res, 'body', {
      get() { throw new Error('streaming path taken for a small response'); }
    });
    return res;
  }) as typeof fetch;
}

const doc = { ok: true, list: [1, 2, 3], nested: { s: 'a string', n: null } };

describe('jget parser selection', () => {
  it('uses the native parser for a response that declares a small size', async () => {
    const body = JSON.stringify(doc);
    respondNativeOnly(body, String(body.length));
    expect(await jget('/api/health')).toEqual(doc);
  });

  it('streams when the declared size is over the limit', async () => {
    // Declares a size past the limit while actually being small, so the streaming
    // path runs to completion here rather than needing a real 256 MB body.
    respond(JSON.stringify(doc), { 'content-length': String(NATIVE_PARSE_LIMIT + 1) });
    expect(await jget('/api/recordings/file?path=big')).toEqual(doc);
  });

  it('streams when there is no Content-Length at all', async () => {
    // A chunked response declares nothing, and guessing wrong the other way
    // throws on a body that cannot fit in one string. Unknown means stream.
    respond(JSON.stringify(doc), {});
    expect(await jget('/api/recordings/file?path=chunked')).toEqual(doc);
  });

  it('streams when Content-Length is not a number', async () => {
    respond(JSON.stringify(doc), { 'content-length': 'banana' });
    expect(await jget('/x')).toEqual(doc);
  });

  it('both paths produce the same value for the same document', async () => {
    const body = JSON.stringify(doc);
    respond(body, { 'content-length': String(body.length) });
    const native = await jget('/x');
    respond(body, { 'content-length': String(NATIVE_PARSE_LIMIT + 1) });
    const streamed = await jget('/x');
    expect(streamed).toEqual(native);
  });

  it('parses a body split across many stream chunks', async () => {
    const big = { frames: Array.from({ length: 500 }, (_, i) => ({ i, s: 'x'.repeat(50) })) };
    const body = JSON.stringify(big);
    globalThis.fetch = (async () => new Response(
      new ReadableStream({
        start(controller) {
          const bytes = new TextEncoder().encode(body);
          for (let i = 0; i < bytes.length; i += 1000) controller.enqueue(bytes.subarray(i, i + 1000));
          controller.close();
        }
      }),
      { headers: { 'content-length': String(NATIVE_PARSE_LIMIT + 1) } }
    )) as typeof fetch;
    expect(await jget('/x')).toEqual(big);
  });

  it('throws the body text on a non-ok response, before parsing anything', async () => {
    respond('scenario not found', { 'content-length': '18' }, { status: 404 });
    await expect(jget('/x')).rejects.toThrow('scenario not found');
  });
});
