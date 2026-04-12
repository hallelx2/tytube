// Cross-runtime HTTP wrapper around the global `fetch` API.
// Works in Node 18+, Bun, Deno, and browsers.

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  method?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T = unknown>(): Promise<T>;
}

export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function mergeHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_HEADERS, ...(extra ?? {}) };
}

function buildAbortSignal(opts: HttpRequestOptions): AbortSignal | undefined {
  if (opts.signal && !opts.timeoutMs) return opts.signal;
  if (!opts.signal && !opts.timeoutMs) return undefined;

  const ctl = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => ctl.abort(opts.signal!.reason), { once: true });
  }
  if (opts.timeoutMs) {
    setTimeout(() => ctl.abort(new Error(`Request timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
  }
  return ctl.signal;
}

async function doFetch(url: string, opts: HttpRequestOptions): Promise<HttpResponse> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: mergeHeaders(opts.headers),
    signal: buildAbortSignal(opts),
  };
  if (opts.body !== undefined) init.body = opts.body as BodyInit;

  const res = await fetch(url, init);
  return {
    status: res.status,
    headers: res.headers,
    body: res.body,
    text: () => res.text(),
    arrayBuffer: () => res.arrayBuffer(),
    json: <T,>() => res.json() as Promise<T>,
  };
}

export async function httpGet(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  return doFetch(url, { ...opts, method: 'GET' });
}

export async function httpPost(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  return doFetch(url, { ...opts, method: 'POST' });
}

export async function httpHead(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
  return doFetch(url, { ...opts, method: 'HEAD' });
}
