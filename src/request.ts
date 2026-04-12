// HTTP layer that mirrors pytube/request.py — get/post/stream/seqStream/filesize/head
// implemented on top of the cross-runtime fetch wrapper.

import { MaxRetriesExceeded, RegexMatchError } from './exceptions.js';
import { httpGet, httpHead, httpPost, type HttpRequestOptions } from './runtime/http.js';

export const DEFAULT_RANGE_SIZE = 9_437_184; // 9 MB

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** GET a URL and return the body as a UTF-8 string. */
export async function get(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await httpGet(url, toFetchOpts(opts));
  return res.text();
}

/** POST a JSON body to `url`. Returns the response body as a UTF-8 string. */
export async function post(
  url: string,
  data: unknown,
  opts: RequestOptions = {},
): Promise<string> {
  const headers = { ...(opts.headers ?? {}), 'Content-Type': 'application/json' };
  const body = data === undefined ? '{}' : JSON.stringify(data);
  const res = await httpPost(url, { ...toFetchOpts(opts), headers, body });
  return res.text();
}

/** Fetch headers via HEAD; returns lowercased header map. */
export async function head(url: string, opts: RequestOptions = {}): Promise<Record<string, string>> {
  const res = await httpHead(url, toFetchOpts(opts));
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Get a remote file's content length in bytes via HEAD. */
export async function filesize(url: string, opts: RequestOptions = {}): Promise<number> {
  const headers = await head(url, opts);
  const len = headers['content-length'];
  if (!len) throw new Error('Missing content-length header');
  return parseInt(len, 10);
}

/**
 * Yields the response body in 9MB chunks via byte-range requests.
 * Mirrors pytube/request.stream.
 */
export async function* stream(url: string, opts: RequestOptions = {}): AsyncGenerator<Uint8Array> {
  let fileSize = DEFAULT_RANGE_SIZE; // placeholder until first range response tells us the real size
  let downloaded = 0;
  const maxRetries = opts.maxRetries ?? 0;

  // Probe the real file size with a wide range request.
  try {
    const probe = await httpGet(`${url}&range=0-99999999999`, toFetchOpts(opts));
    const cl = probe.headers.get('content-length');
    if (cl) fileSize = parseInt(cl, 10);
    // Drain the probe body to free the socket on Bun/Node.
    if (probe.body) {
      const reader = probe.body.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } finally {
        reader.releaseLock();
      }
    }
  } catch {
    // Best-effort probe; fall back to 9MB stepping.
  }

  while (downloaded < fileSize) {
    const stopPos = Math.min(downloaded + DEFAULT_RANGE_SIZE, fileSize) - 1;
    const rangeUrl = `${url}&range=${downloaded}-${stopPos}`;

    let attempt = 0;
    let body: ReadableStream<Uint8Array> | null = null;
    while (true) {
      if (attempt > maxRetries) throw new MaxRetriesExceeded();
      try {
        const res = await httpGet(rangeUrl, {
          ...toFetchOpts(opts),
          headers: { ...(opts.headers ?? {}), Range: `bytes=${downloaded}-${stopPos}` },
        });
        body = res.body;
        break;
      } catch (err) {
        if (isAbortError(err)) throw err;
        attempt++;
      }
    }

    if (!body) throw new MaxRetriesExceeded();

    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        downloaded += value.byteLength;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Sequence-based stream for OTF / segmented videos.
 * Mirrors pytube/request.seq_stream.
 */
export async function* seqStream(url: string, opts: RequestOptions = {}): AsyncGenerator<Uint8Array> {
  const parsed = new URL(url);
  parsed.searchParams.set('sq', '0');
  const headerUrl = parsed.toString();

  const collected: Uint8Array[] = [];
  for await (const chunk of stream(headerUrl, opts)) {
    yield chunk;
    collected.push(chunk);
  }
  const segmentData = concatAll(collected);

  const text = new TextDecoder('utf-8').decode(segmentData);
  const segmentCountMatch = /Segment-Count:\s*(\d+)/.exec(text);
  const segmentCountRaw = segmentCountMatch?.[1];
  if (!segmentCountRaw) {
    throw new RegexMatchError('seqStream', /Segment-Count:\s*(\d+)/);
  }
  const segmentCount = parseInt(segmentCountRaw, 10);

  for (let seq = 1; seq <= segmentCount; seq++) {
    parsed.searchParams.set('sq', String(seq));
    const segUrl = parsed.toString();
    yield* stream(segUrl, opts);
  }
}

/** Sum file sizes across all sequential segments. */
export async function seqFilesize(url: string, opts: RequestOptions = {}): Promise<number> {
  const parsed = new URL(url);
  parsed.searchParams.set('sq', '0');
  const headerRes = await httpGet(parsed.toString(), toFetchOpts(opts));
  const headerBytes = new Uint8Array(await headerRes.arrayBuffer());

  let total = headerBytes.byteLength;
  const text = new TextDecoder('utf-8').decode(headerBytes);
  const match = /Segment-Count:\s*(\d+)/.exec(text);
  const matchRaw = match?.[1];
  if (!matchRaw) {
    throw new RegexMatchError('seqFilesize', /Segment-Count:\s*(\d+)/);
  }
  const segmentCount = parseInt(matchRaw, 10);

  for (let seq = 1; seq <= segmentCount; seq++) {
    parsed.searchParams.set('sq', String(seq));
    total += await filesize(parsed.toString(), opts);
  }
  return total;
}

function toFetchOpts(opts: RequestOptions): HttpRequestOptions {
  return {
    headers: opts.headers,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
}

function concatAll(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
