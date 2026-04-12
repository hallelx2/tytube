// Container for stream manifest data. Mirrors pytube/streams.py.

import { mimeTypeCodec, type StreamFormat } from './extract.js';
import { getFormatProfile } from './itags.js';
import { safeFilename } from './helpers.js';
import { filesize as remoteFilesize, seqFilesize, seqStream, stream as rangeStream, type RequestOptions } from './request.js';
import { ensureDir, fileExists, getFs } from './runtime/fs.js';
import { joinPath, resolveOutputDir } from './runtime/path.js';

export interface SharedState {
  title: string | null;
  duration: number | null;
  onProgress?: (stream: Stream, chunk: Uint8Array, bytesRemaining: number) => void;
  onComplete?: (stream: Stream, filePath: string | null) => void;
}

export interface DownloadOptions {
  outputPath?: string;
  filename?: string;
  filenamePrefix?: string;
  skipExisting?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

export class Stream {
  readonly itag: number;
  url: string;
  readonly mimeType: string;
  readonly codecs: string[];
  readonly type: string;
  readonly subtype: string;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly isOtf: boolean;
  readonly bitrate: number | null;
  readonly fps: number | null;
  readonly resolution: string | null;
  readonly abr: string | null;
  readonly isDash: boolean;
  readonly is3d: boolean;
  readonly isHdr: boolean;
  readonly isLive: boolean;

  private cachedFilesize: number;
  private readonly state: SharedState;

  constructor(raw: StreamFormat, state: SharedState) {
    this.state = state;
    if (!raw.url) throw new Error('Stream missing url after descrambling');
    this.url = raw.url;
    this.itag = typeof raw.itag === 'string' ? parseInt(raw.itag, 10) : raw.itag;

    const { mimeType, codecs } = mimeTypeCodec(raw.mimeType ?? '');
    this.mimeType = mimeType;
    this.codecs = codecs;
    const [type, subtype] = mimeType.split('/');
    this.type = type ?? '';
    this.subtype = subtype ?? '';
    [this.videoCodec, this.audioCodec] = this.parseCodecs();

    this.isOtf = raw.is_otf ?? false;
    this.bitrate = raw.bitrate ?? null;
    this.cachedFilesize = parseInt(String(raw.contentLength ?? '0'), 10);

    const profile = getFormatProfile(this.itag);
    this.isDash = profile.isDash;
    this.abr = profile.abr;
    this.fps = raw.fps ?? null;
    this.resolution = profile.resolution;
    this.is3d = profile.is3d;
    this.isHdr = profile.isHdr;
    this.isLive = profile.isLive;
  }

  // Adaptive = single codec list (audio-only OR video-only)
  get isAdaptive(): boolean {
    return this.codecs.length % 2 === 1;
  }

  get isProgressive(): boolean {
    return !this.isAdaptive;
  }

  get includesAudioTrack(): boolean {
    return this.isProgressive || this.type === 'audio';
  }

  get includesVideoTrack(): boolean {
    return this.isProgressive || this.type === 'video';
  }

  private parseCodecs(): [string | null, string | null] {
    let video: string | null = null;
    let audio: string | null = null;
    if (this.codecs.length === 0) return [null, null];
    if (this.codecs.length === 2) {
      video = this.codecs[0] ?? null;
      audio = this.codecs[1] ?? null;
    } else if (this.codecs.length === 1) {
      // Single codec — could be audio or video; we don't know yet because mime
      // type isn't set in this constructor. Defer: caller can re-derive from type.
      video = this.codecs[0] ?? null;
    }
    return [video, audio];
  }

  get title(): string {
    return this.state.title ?? 'Unknown YouTube Video Title';
  }

  async filesize(): Promise<number> {
    if (this.cachedFilesize === 0) {
      try {
        this.cachedFilesize = await remoteFilesize(this.url);
      } catch {
        this.cachedFilesize = await seqFilesize(this.url);
      }
    }
    return this.cachedFilesize;
  }

  async filesizeApprox(): Promise<number> {
    if (this.state.duration && this.bitrate) {
      return Math.floor((this.state.duration * this.bitrate) / 8);
    }
    return this.filesize();
  }

  get expiration(): Date | null {
    try {
      const u = new URL(this.url);
      const expire = u.searchParams.get('expire');
      if (!expire) return null;
      return new Date(parseInt(expire, 10) * 1000);
    } catch {
      return null;
    }
  }

  get defaultFilename(): string {
    return `${safeFilename(this.title)}.${this.subtype}`;
  }

  /** Compute the absolute output path the download will be written to. */
  async getFilePath(opts: DownloadOptions = {}): Promise<string> {
    const filename = opts.filename ?? this.defaultFilename;
    const prefixed = opts.filenamePrefix ? `${opts.filenamePrefix}${filename}` : filename;
    const dir = await resolveOutputDir(opts.outputPath);
    await ensureDir(dir);
    return joinPath(dir, prefixed);
  }

  async existsAtPath(filePath: string): Promise<boolean> {
    if (!(await fileExists(filePath))) return false;
    const fs = await getFs();
    if (!fs) return false;
    const expected = await this.filesize();
    const stat = await fs.stat(filePath);
    return stat.size === expected;
  }

  /**
   * Download the stream to the local filesystem and return the absolute path.
   * Throws if no filesystem is available (e.g., browser); use streamChunks() instead.
   */
  async download(opts: DownloadOptions = {}): Promise<string> {
    const fs = await getFs();
    if (!fs) {
      throw new Error('Filesystem unavailable in this runtime; use streamChunks() instead.');
    }

    const filePath = await this.getFilePath(opts);
    const skipExisting = opts.skipExisting ?? true;
    if (skipExisting && (await this.existsAtPath(filePath))) {
      this.fireOnComplete(filePath);
      return filePath;
    }

    let bytesRemaining = await this.filesize();
    const reqOpts: RequestOptions = {
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries ?? 0,
      signal: opts.signal,
    };

    const handle = await fs.open(filePath, 'w');
    try {
      let usedSeqStream = false;
      try {
        for await (const chunk of rangeStream(this.url, reqOpts)) {
          await handle.write(chunk);
          bytesRemaining -= chunk.byteLength;
          this.fireOnProgress(chunk, bytesRemaining);
        }
      } catch (err) {
        // Some adaptive streams 404 on range requests and need sequential segments.
        if (!is404(err)) throw err;
        usedSeqStream = true;
      }
      if (usedSeqStream) {
        for await (const chunk of seqStream(this.url, reqOpts)) {
          await handle.write(chunk);
          bytesRemaining -= chunk.byteLength;
          this.fireOnProgress(chunk, bytesRemaining);
        }
      }
    } finally {
      await handle.close();
    }

    this.fireOnComplete(filePath);
    return filePath;
  }

  /**
   * Stream the media as raw chunks. Browser-friendly alternative to download().
   * Caller is responsible for collecting the chunks (write to a Blob, sink, etc.).
   */
  async *streamChunks(opts: DownloadOptions = {}): AsyncGenerator<Uint8Array> {
    const reqOpts: RequestOptions = {
      timeoutMs: opts.timeoutMs,
      maxRetries: opts.maxRetries ?? 0,
      signal: opts.signal,
    };
    let bytesRemaining = await this.filesize();
    try {
      for await (const chunk of rangeStream(this.url, reqOpts)) {
        bytesRemaining -= chunk.byteLength;
        this.fireOnProgress(chunk, bytesRemaining);
        yield chunk;
      }
    } catch (err) {
      if (!is404(err)) throw err;
      for await (const chunk of seqStream(this.url, reqOpts)) {
        bytesRemaining -= chunk.byteLength;
        this.fireOnProgress(chunk, bytesRemaining);
        yield chunk;
      }
    }
    this.fireOnComplete(null);
  }

  private fireOnProgress(chunk: Uint8Array, bytesRemaining: number): void {
    this.state.onProgress?.(this, chunk, bytesRemaining);
  }

  private fireOnComplete(path: string | null): void {
    this.state.onComplete?.(this, path);
  }

  toString(): string {
    const parts: string[] = [`itag="${this.itag}"`, `mime_type="${this.mimeType}"`];
    if (this.includesVideoTrack) {
      parts.push(`res="${this.resolution}"`, `fps="${this.fps}fps"`);
      if (!this.isAdaptive) {
        parts.push(`vcodec="${this.videoCodec}"`, `acodec="${this.audioCodec}"`);
      } else {
        parts.push(`vcodec="${this.videoCodec}"`);
      }
    } else {
      parts.push(`abr="${this.abr}"`, `acodec="${this.audioCodec}"`);
    }
    parts.push(`progressive="${this.isProgressive}"`, `type="${this.type}"`);
    return `<Stream: ${parts.join(' ')}>`;
  }
}

function is404(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as Error).message ?? '';
  return msg.includes('404');
}
