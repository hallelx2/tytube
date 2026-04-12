// Non-cipher data extraction logic. Mirrors pytube/extract.py.
// All regexes are ported from pytube as-is wherever possible.

import { HTMLParseError, LiveStreamError, RegexMatchError } from './exceptions.js';
import { regexSearch } from './helpers.js';
import { YouTubeMetadata } from './metadata.js';
import { parseForAllObjects, parseForObject } from './parser.js';
import type { CipherLike } from './cipher-types.js';

// ---------- URL helpers ----------

export function videoId(url: string): string {
  return regexSearch(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/, url, 1);
}

export function playlistId(url: string): string {
  const u = new URL(url);
  const list = u.searchParams.get('list');
  if (!list) throw new RegexMatchError('playlistId', 'list query param');
  return list;
}

export function channelName(url: string): string {
  const patterns: RegExp[] = [
    /(?:\/(c)\/([%\d\w_\-]+)(\/.*)?)/,
    /(?:\/(channel)\/([%\w\d_\-]+)(\/.*)?)/,
    /(?:\/(u)\/([%\d\w_\-]+)(\/.*)?)/,
    /(?:\/(user)\/([%\w\d_\-]+)(\/.*)?)/,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(url);
    if (m) {
      return `/${m[1]}/${m[2]}`;
    }
  }
  throw new RegexMatchError('channelName', 'patterns');
}

// ---------- Watch HTML predicates ----------

export function publishDate(watchHtml: string): Date | null {
  try {
    const result = regexSearch(
      /(?<=itemprop="datePublished" content=")\d{4}-\d{2}-\d{2}/,
      watchHtml,
      0,
    );
    return new Date(`${result}T00:00:00Z`);
  } catch {
    return null;
  }
}

export function recordingAvailable(watchHtml: string): boolean {
  return !watchHtml.includes('This live stream recording is not available.');
}

export function isPrivate(watchHtml: string): boolean {
  const privateStrings = [
    'This is a private video. Please sign in to verify that you may see it.',
    '"simpleText":"Private video"',
    'This video is private.',
  ];
  return privateStrings.some((s) => watchHtml.includes(s));
}

export function isAgeRestricted(watchHtml: string): boolean {
  return /og:restrictions:age/.test(watchHtml);
}

// ---------- Player config / initial data extraction ----------

export interface PlayabilityStatus {
  status: string | null;
  reasons: (string | null)[];
}

export function playabilityStatus(watchHtml: string): PlayabilityStatus {
  const playerResponse = initialPlayerResponse(watchHtml) as Record<string, unknown>;
  const statusDict = (playerResponse['playabilityStatus'] ?? {}) as Record<string, unknown>;
  if ('liveStreamability' in statusDict) {
    return { status: 'LIVE_STREAM', reasons: ['Video is a live stream.'] };
  }
  if ('status' in statusDict) {
    if ('reason' in statusDict) {
      return { status: String(statusDict['status']), reasons: [String(statusDict['reason'])] };
    }
    if ('messages' in statusDict) {
      return {
        status: String(statusDict['status']),
        reasons: (statusDict['messages'] as unknown[]).map((m) => (m === null ? null : String(m))),
      };
    }
  }
  return { status: null, reasons: [null] };
}

export function jsUrl(html: string): string {
  let baseJs: string | undefined;
  try {
    const config = getYtplayerConfig(html) as { assets?: { js?: string } };
    baseJs = config.assets?.js;
  } catch {
    /* fall through */
  }
  if (!baseJs) {
    baseJs = getYtplayerJs(html);
  }
  return `https://youtube.com${baseJs}`;
}

export function getYtplayerJs(html: string): string {
  const patterns: RegExp[] = [/(\/s\/player\/[\w\d]+\/[\w\d_/.]+\/base\.js)/];
  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (m) return m[1]!;
  }
  throw new RegexMatchError('getYtplayerJs', 'jsUrlPatterns');
}

export function getYtplayerConfig(html: string): unknown {
  const configPatterns: RegExp[] = [
    /ytplayer\.config\s*=\s*/,
    /ytInitialPlayerResponse\s*=\s*/,
  ];
  for (const pattern of configPatterns) {
    try {
      return parseForObject(html, pattern);
    } catch {
      continue;
    }
  }

  const setConfigPatterns: RegExp[] = [/yt\.setConfig\(.*['"]PLAYER_CONFIG['"]:\s*/];
  for (const pattern of setConfigPatterns) {
    try {
      return parseForObject(html, pattern);
    } catch {
      continue;
    }
  }

  throw new RegexMatchError('getYtplayerConfig', 'config_patterns, setconfig_patterns');
}

export function getYtcfg(html: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const ytcfgPatterns: RegExp[] = [/ytcfg\s=\s/, /ytcfg\.set\(/];
  for (const pattern of ytcfgPatterns) {
    try {
      const found = parseForAllObjects<Record<string, unknown>>(html, pattern);
      for (const obj of found) Object.assign(merged, obj);
    } catch {
      continue;
    }
  }
  if (Object.keys(merged).length > 0) return merged;
  throw new RegexMatchError('getYtcfg', 'ytcfgPatterns');
}

export function initialData(watchHtml: string): unknown {
  const patterns: RegExp[] = [
    /window\[['"]ytInitialData['"]\]\s*=\s*/,
    /ytInitialData\s*=\s*/,
  ];
  for (const pattern of patterns) {
    try {
      return parseForObject(watchHtml, pattern);
    } catch {
      continue;
    }
  }
  throw new RegexMatchError('initialData', 'initialDataPattern');
}

export function initialPlayerResponse(watchHtml: string): unknown {
  const patterns: RegExp[] = [
    /window\[['"]ytInitialPlayerResponse['"]\]\s*=\s*/,
    /ytInitialPlayerResponse\s*=\s*/,
  ];
  for (const pattern of patterns) {
    try {
      return parseForObject(watchHtml, pattern);
    } catch {
      continue;
    }
  }
  throw new RegexMatchError('initialPlayerResponse', 'initialPlayerResponsePattern');
}

// ---------- MIME type / codec parsing ----------

export function mimeTypeCodec(input: string): { mimeType: string; codecs: string[] } {
  const pattern = /(\w+\/\w+);\s*codecs="([a-zA-Z\-0-9.,\s]*)"/;
  const m = pattern.exec(input);
  if (!m) throw new RegexMatchError('mimeTypeCodec', pattern);
  const codecs = m[2]!.split(',').map((c) => c.trim());
  return { mimeType: m[1]!, codecs };
}

// ---------- Stream manifest descrambling ----------

export interface StreamFormat {
  itag: number;
  url?: string;
  signatureCipher?: string;
  cipher?: string;
  s?: string;
  type?: string;
  is_otf?: boolean;
  mimeType?: string;
  bitrate?: number;
  contentLength?: string;
  width?: number;
  height?: number;
  fps?: number;
  qualityLabel?: string;
  audioQuality?: string;
  averageBitrate?: number;
  approxDurationMs?: string;
  [key: string]: unknown;
}

/**
 * Merge progressive `formats` and `adaptiveFormats`, lift signatureCipher
 * fields into top-level `url`/`s`, and tag OTF segmented streams. Returns
 * the merged list. Mutates entries in place to match pytube's behavior.
 */
export function applyDescrambler(streamData: {
  url?: unknown;
  formats?: StreamFormat[];
  adaptiveFormats?: StreamFormat[];
}): StreamFormat[] | null {
  if ('url' in streamData && streamData.url !== undefined) return null;

  const formats: StreamFormat[] = [];
  if (streamData.formats) formats.push(...streamData.formats);
  if (streamData.adaptiveFormats) formats.push(...streamData.adaptiveFormats);

  for (const data of formats) {
    if (!data.url) {
      const cipher = data.signatureCipher ?? data.cipher;
      if (cipher) {
        const params = new URLSearchParams(cipher);
        const u = params.get('url');
        const s = params.get('s');
        if (u) data.url = u;
        if (s !== null) data.s = s;
      }
    }
    data.is_otf = data.type === 'FORMAT_STREAM_TYPE_OTF';
  }
  return formats;
}

/**
 * Returns true if any stream in the manifest needs cipher decryption.
 * Used to decide whether we should pay the cost (and risk) of building a Cipher.
 */
export function manifestNeedsCipher(streamManifest: StreamFormat[]): boolean {
  return streamManifest.some((s) => s.s !== undefined && s.s !== null);
}

/**
 * Returns true if any stream's URL has an `n` parameter that needs to be
 * passed through the throttling function. Modern progressive streams often
 * already include a valid `n`, in which case we still want to transform it,
 * but the streams that came pre-signed (no `s` field) may also already have
 * a working `n`. Be lenient: only transform `n` when we built a cipher.
 */
function needsThrottlingTransform(url: string): boolean {
  try {
    const u = new URL(url);
    return u.searchParams.has('n') && !u.searchParams.has('ratebypass');
  } catch {
    return false;
  }
}

/**
 * Apply the decrypted signature + n-parameter to every stream in the manifest.
 * Mutates entries in place to set the playable `url` field.
 *
 * `cipher` is null when no stream actually needs decryption — in that case we
 * just validate that each stream has a usable URL and skip the rest.
 */
export function applySignature(
  streamManifest: StreamFormat[],
  vidInfo: Record<string, unknown>,
  cipher: CipherLike | null,
): void {
  for (let i = 0; i < streamManifest.length; i++) {
    const stream = streamManifest[i];
    if (!stream) continue;
    const url = stream.url;
    if (!url) {
      const liveStream = (vidInfo['playabilityStatus'] as Record<string, unknown> | undefined)?.[
        'liveStreamability'
      ];
      if (liveStream) throw new LiveStreamError('UNKNOWN');
      continue;
    }

    // Pre-signed URLs need no work.
    const preSigned =
      url.includes('signature') ||
      (!stream.s && (url.includes('&sig=') || url.includes('&lsig=')));

    if (stream.s !== undefined && stream.s !== null && cipher) {
      const signature = cipher.getSignature(stream.s);
      const parsed = new URL(url);
      parsed.searchParams.set('sig', signature);
      if (needsThrottlingTransform(url)) {
        const initialN = parsed.searchParams.get('n');
        if (initialN) {
          try {
            parsed.searchParams.set('n', cipher.calculateN(initialN));
          } catch {
            // Throttling failure shouldn't kill the whole stream — leave n alone.
          }
        }
      }
      stream.url = `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
    } else if (cipher && needsThrottlingTransform(url)) {
      // Pre-signed URL but `n` still needs the throttling transform.
      try {
        const parsed = new URL(url);
        const initialN = parsed.searchParams.get('n');
        if (initialN) {
          parsed.searchParams.set('n', cipher.calculateN(initialN));
          stream.url = `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
        }
      } catch {
        /* leave url as-is */
      }
    }
    // If we get here with no cipher and a pre-signed URL, the stream is ready as-is.
    void preSigned;
  }
}

// ---------- Metadata block extraction ----------

export function metadata(initialDataObj: unknown): YouTubeMetadata {
  try {
    const root = initialDataObj as Record<string, unknown>;
    // contents.twoColumnWatchNextResults.results.results.contents[1].videoSecondaryInfoRenderer
    //   .metadataRowContainer.metadataRowContainerRenderer.rows
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const rows: any[] =
      (root as any)?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.[1]
        ?.videoSecondaryInfoRenderer?.metadataRowContainer?.metadataRowContainerRenderer?.rows ?? [];
    const filtered = rows.filter((x: any) => x && 'metadataRowRenderer' in x);
    const mapped = filtered.map((x: any) => x.metadataRowRenderer);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return new YouTubeMetadata(mapped);
  } catch {
    return new YouTubeMetadata([]);
  }
}

// Re-export so callers don't need to import HTMLParseError separately
export { HTMLParseError };
