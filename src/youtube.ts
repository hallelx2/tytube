// Core developer interface. Mirrors pytube/__main__.py.
//
// Pytube exposes synchronous getters that secretly perform network I/O on
// first access. TypeScript getters can't be async, so tytube exposes async
// methods (`await yt.title()`) plus a `prefetch()` method that fills the
// internal cache. After prefetch, the sync `*Sync` getters work.

import { Caption } from './captions.js';
import { createCipher } from './cipher.js';
import * as exceptions from './exceptions.js';
import * as extract from './extract.js';
import { InnerTube } from './innertube.js';
import { YouTubeMetadata } from './metadata.js';
import { CaptionQuery, StreamQuery } from './query.js';
import { get as httpGetText } from './request.js';
import { Stream, type SharedState } from './stream.js';

export interface YouTubeOptions {
  onProgress?: SharedState['onProgress'];
  onComplete?: SharedState['onComplete'];
  useOauth?: boolean;
  allowOauthCache?: boolean;
}

interface YtVideoDetails {
  videoId?: string;
  title?: string;
  lengthSeconds?: string;
  author?: string;
  shortDescription?: string;
  averageRating?: number;
  viewCount?: string;
  channelId?: string;
  thumbnail?: { thumbnails?: Array<{ url: string }> };
  keywords?: string[];
}

interface YtCaptionTrackRaw {
  baseUrl: string;
  name?: { simpleText?: string; runs?: Array<{ text: string }> };
  vssId?: string;
  languageCode?: string;
}

interface PlayerResponse {
  videoDetails?: YtVideoDetails;
  playabilityStatus?: { status?: string; reason?: string; messages?: string[]; liveStreamability?: unknown };
  streamingData?: { formats?: extract.StreamFormat[]; adaptiveFormats?: extract.StreamFormat[] };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: YtCaptionTrackRaw[] } };
}

export class YouTube {
  readonly videoId: string;
  readonly watchUrl: string;
  readonly embedUrl: string;
  readonly useOauth: boolean;
  readonly allowOauthCache: boolean;
  readonly state: SharedState;

  private cachedJs: string | null = null;
  private cachedJsUrl: string | null = null;
  private cachedVidInfo: PlayerResponse | null = null;
  private cachedWatchHtml: string | null = null;
  private cachedEmbedHtml: string | null = null;
  private cachedAgeRestricted: boolean | null = null;
  private cachedFmtStreams: Stream[] | null = null;
  private cachedInitialData: unknown | null = null;
  private cachedMetadata: YouTubeMetadata | null = null;
  private cachedTitle: string | null = null;
  private cachedAuthor: string | null = null;
  private cachedPublishDate: Date | null | undefined = undefined;

  constructor(url: string, opts: YouTubeOptions = {}) {
    this.videoId = extract.videoId(url);
    this.watchUrl = `https://youtube.com/watch?v=${this.videoId}`;
    this.embedUrl = `https://www.youtube.com/embed/${this.videoId}`;
    this.useOauth = opts.useOauth ?? false;
    this.allowOauthCache = opts.allowOauthCache ?? true;
    this.state = {
      title: null,
      duration: null,
      onProgress: opts.onProgress,
      onComplete: opts.onComplete,
    };
  }

  static fromId(videoId: string): YouTube {
    return new YouTube(`https://www.youtube.com/watch?v=${videoId}`);
  }

  // ---------- Lazy network resources ----------

  async watchHtml(): Promise<string> {
    if (this.cachedWatchHtml) return this.cachedWatchHtml;
    this.cachedWatchHtml = await httpGetText(this.watchUrl);
    return this.cachedWatchHtml;
  }

  async embedHtml(): Promise<string> {
    if (this.cachedEmbedHtml) return this.cachedEmbedHtml;
    this.cachedEmbedHtml = await httpGetText(this.embedUrl);
    return this.cachedEmbedHtml;
  }

  async ageRestricted(): Promise<boolean> {
    if (this.cachedAgeRestricted !== null) return this.cachedAgeRestricted;
    this.cachedAgeRestricted = extract.isAgeRestricted(await this.watchHtml());
    return this.cachedAgeRestricted;
  }

  async jsUrl(): Promise<string> {
    if (this.cachedJsUrl) return this.cachedJsUrl;
    const html = (await this.ageRestricted()) ? await this.embedHtml() : await this.watchHtml();
    this.cachedJsUrl = extract.jsUrl(html);
    return this.cachedJsUrl;
  }

  async js(): Promise<string> {
    if (this.cachedJs) return this.cachedJs;
    const url = await this.jsUrl();
    this.cachedJs = await httpGetText(url);
    return this.cachedJs;
  }

  async initialData(): Promise<unknown> {
    if (this.cachedInitialData) return this.cachedInitialData;
    this.cachedInitialData = extract.initialData(await this.watchHtml());
    return this.cachedInitialData;
  }

  /**
   * Resolve the player response containing videoDetails + streamingData.
   *
   * Strategy (late-2025 reality):
   *   1. Primary: scrape `ytInitialPlayerResponse` from the watch HTML. This is
   *      the same payload a browser sees and contains streamingData + captions.
   *   2. Fallback: InnerTube /player endpoint (useful for age-gate bypass, but
   *      currently rate-limited by YouTube's "Sign in to confirm you're not a
   *      bot" check for server-side IPs).
   *
   * If the primary path returns a useful response we never touch InnerTube,
   * which avoids the bot-detection entirely for normal public videos.
   */
  async vidInfo(): Promise<PlayerResponse> {
    if (this.cachedVidInfo) return this.cachedVidInfo;

    try {
      const html = await this.watchHtml();
      const fromHtml = extract.initialPlayerResponse(html) as PlayerResponse;
      if (fromHtml?.videoDetails && fromHtml?.streamingData) {
        this.cachedVidInfo = fromHtml;
        return fromHtml;
      }
      // If the watch HTML is missing streamingData (e.g. age-gate), fall
      // through to InnerTube below which may unblock it via ANDROID_EMBED.
    } catch {
      /* fall through to InnerTube */
    }

    const innertube = new InnerTube({ useOauth: this.useOauth });
    this.cachedVidInfo = (await innertube.player(this.videoId)) as PlayerResponse;
    return this.cachedVidInfo;
  }

  async streamingData(): Promise<NonNullable<PlayerResponse['streamingData']>> {
    let info = await this.vidInfo();
    if (!info.streamingData) {
      await this.bypassAgeGate();
      info = await this.vidInfo();
    }
    if (!info.streamingData) {
      throw new exceptions.VideoUnavailable(this.videoId);
    }
    return info.streamingData;
  }

  // ---------- Availability gates ----------

  async checkAvailability(): Promise<void> {
    const html = await this.watchHtml();
    const { status, reasons } = extract.playabilityStatus(html);

    for (const reason of reasons) {
      if (status === 'UNPLAYABLE') {
        if (
          reason ===
          'Join this channel to get access to members-only content like this video, and other exclusive perks.'
        ) {
          throw new exceptions.MembersOnly(this.videoId);
        }
        if (reason === 'This live stream recording is not available.') {
          throw new exceptions.RecordingUnavailable(this.videoId);
        }
        throw new exceptions.VideoUnavailable(this.videoId);
      } else if (status === 'LOGIN_REQUIRED') {
        if (
          reason === 'This is a private video. Please sign in to verify that you may see it.'
        ) {
          throw new exceptions.VideoPrivate(this.videoId);
        }
      } else if (status === 'ERROR') {
        if (reason === 'Video unavailable') {
          throw new exceptions.VideoUnavailable(this.videoId);
        }
      } else if (status === 'LIVE_STREAM') {
        throw new exceptions.LiveStreamError(this.videoId);
      }
    }
  }

  async bypassAgeGate(): Promise<void> {
    const innertube = new InnerTube({ client: 'ANDROID_EMBED', useOauth: this.useOauth });
    const response = (await innertube.player(this.videoId)) as PlayerResponse;
    const status = response.playabilityStatus?.status;
    if (status === 'UNPLAYABLE') {
      throw new exceptions.AgeRestrictedError(this.videoId);
    }
    this.cachedVidInfo = response;
  }

  // ---------- Streams ----------

  async fmtStreams(): Promise<Stream[]> {
    await this.checkAvailability();
    if (this.cachedFmtStreams) return this.cachedFmtStreams;

    const result: Stream[] = [];
    const streamingData = await this.streamingData();
    const manifest = extract.applyDescrambler({
      formats: streamingData.formats,
      adaptiveFormats: streamingData.adaptiveFormats,
    });
    if (!manifest) return result;

    const vidInfo = (await this.vidInfo()) as unknown as Record<string, unknown>;

    // Only build a Cipher if we actually have ciphered streams. Many videos
    // (especially those scraped from the watch HTML path) come pre-signed and
    // don't need any decryption — building the cipher in that case is just
    // unnecessary risk because YouTube's base.js evolves constantly.
    const needsCipher = extract.manifestNeedsCipher(manifest);
    let cipher = null as ReturnType<typeof createCipher> | null;
    if (needsCipher) {
      try {
        const js = await this.js();
        cipher = createCipher(js);
      } catch (err) {
        if (!(err instanceof exceptions.ExtractError)) throw err;
        // Bust cached js and retry once — base.js may have rotated mid-fetch.
        this.cachedJs = null;
        this.cachedJsUrl = null;
        try {
          const freshJs = await this.js();
          cipher = createCipher(freshJs);
        } catch {
          // Give up on cipher; pre-signed streams will still work, ciphered ones won't.
          cipher = null;
        }
      }
    }

    extract.applySignature(manifest, vidInfo, cipher);

    // Populate shared state before constructing streams so they get a usable title.
    this.state.title = await this.title();
    this.state.duration = await this.length();

    for (const raw of manifest) {
      // Skip streams we couldn't sign — including them would hand the user a 403.
      if (!raw.url) continue;
      if (raw.s !== undefined && raw.s !== null && !cipher) continue;
      result.push(new Stream(raw, this.state));
    }

    this.cachedFmtStreams = result;
    return result;
  }

  async streams(): Promise<StreamQuery> {
    await this.checkAvailability();
    return new StreamQuery(await this.fmtStreams());
  }

  // ---------- Captions ----------

  async captionTracks(): Promise<Caption[]> {
    const info = await this.vidInfo();
    const tracks = info.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return tracks.map((t) => new Caption(t));
  }

  async captions(): Promise<CaptionQuery> {
    return new CaptionQuery(await this.captionTracks());
  }

  // ---------- Metadata ----------

  async title(): Promise<string> {
    if (this.cachedTitle) return this.cachedTitle;
    const info = await this.vidInfo();
    const t = info.videoDetails?.title;
    if (!t) {
      await this.checkAvailability();
      throw new exceptions.PytubeError(`Could not extract title for ${this.watchUrl}`);
    }
    this.cachedTitle = t;
    return t;
  }

  async description(): Promise<string | null> {
    return (await this.vidInfo()).videoDetails?.shortDescription ?? null;
  }

  async length(): Promise<number> {
    const len = (await this.vidInfo()).videoDetails?.lengthSeconds;
    return len ? parseInt(len, 10) : 0;
  }

  async views(): Promise<number> {
    const v = (await this.vidInfo()).videoDetails?.viewCount;
    return v ? parseInt(v, 10) : 0;
  }

  async rating(): Promise<number | null> {
    return (await this.vidInfo()).videoDetails?.averageRating ?? null;
  }

  async author(): Promise<string> {
    if (this.cachedAuthor) return this.cachedAuthor;
    this.cachedAuthor = (await this.vidInfo()).videoDetails?.author ?? 'unknown';
    return this.cachedAuthor;
  }

  async keywords(): Promise<string[]> {
    return (await this.vidInfo()).videoDetails?.keywords ?? [];
  }

  async channelId(): Promise<string | null> {
    return (await this.vidInfo()).videoDetails?.channelId ?? null;
  }

  async channelUrl(): Promise<string> {
    return `https://www.youtube.com/channel/${await this.channelId()}`;
  }

  async thumbnailUrl(): Promise<string> {
    const thumbnails = (await this.vidInfo()).videoDetails?.thumbnail?.thumbnails;
    if (thumbnails && thumbnails.length > 0) {
      return thumbnails[thumbnails.length - 1]!.url;
    }
    return `https://img.youtube.com/vi/${this.videoId}/maxresdefault.jpg`;
  }

  async publishDate(): Promise<Date | null> {
    if (this.cachedPublishDate !== undefined) return this.cachedPublishDate;
    this.cachedPublishDate = extract.publishDate(await this.watchHtml());
    return this.cachedPublishDate;
  }

  async metadata(): Promise<YouTubeMetadata> {
    if (this.cachedMetadata) return this.cachedMetadata;
    this.cachedMetadata = extract.metadata(await this.initialData());
    return this.cachedMetadata;
  }

  // ---------- Prefetch + sync getters ----------

  /**
   * Fetch and cache everything needed for synchronous metadata access.
   * After this resolves, the *Sync getters and the `streams` getter return
   * results immediately without further network I/O.
   */
  async prefetch(): Promise<void> {
    await this.watchHtml();
    await this.vidInfo();
    await this.title();
    await this.author();
    await this.length();
    await this.fmtStreams();
  }

  get titleSync(): string {
    if (!this.cachedTitle) throw new Error('Call await yt.prefetch() first.');
    return this.cachedTitle;
  }

  get authorSync(): string {
    if (!this.cachedAuthor) throw new Error('Call await yt.prefetch() first.');
    return this.cachedAuthor;
  }

  get streamsSync(): StreamQuery {
    if (!this.cachedFmtStreams) throw new Error('Call await yt.prefetch() first.');
    return new StreamQuery(this.cachedFmtStreams);
  }

  // ---------- Misc ----------

  registerOnProgressCallback(fn: SharedState['onProgress']): void {
    this.state.onProgress = fn;
  }

  registerOnCompleteCallback(fn: SharedState['onComplete']): void {
    this.state.onComplete = fn;
  }

  toString(): string {
    return `<YouTube videoId=${this.videoId}>`;
  }

  equals(other: unknown): boolean {
    return other instanceof YouTube && other.watchUrl === this.watchUrl;
  }
}
