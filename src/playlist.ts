// YouTube playlist loader. Mirrors pytube/contrib/playlist.py.
// Implemented as an async iterable of YouTube objects so iterating doesn't
// force every continuation page to load up front.

import * as extract from './extract.js';
import { uniqueify } from './helpers.js';
import { post, get as httpGetText } from './request.js';
import { YouTube } from './youtube.js';

interface ContinuationRequest {
  url: string;
  headers: Record<string, string>;
  data: Record<string, unknown>;
}

export class Playlist implements AsyncIterable<YouTube> {
  protected readonly inputUrl: string;
  private cachedHtml: string | null = null;
  private cachedYtcfg: Record<string, unknown> | null = null;
  private cachedInitialData: Record<string, unknown> | null = null;
  private cachedSidebar: unknown[] | null = null;
  private cachedPlaylistId: string | null = null;
  private cachedVideoUrls: string[] | null = null;

  constructor(url: string) {
    this.inputUrl = url;
  }

  // ---------- Identifiers ----------

  get playlistId(): string {
    if (this.cachedPlaylistId) return this.cachedPlaylistId;
    this.cachedPlaylistId = extract.playlistId(this.inputUrl);
    return this.cachedPlaylistId;
  }

  get playlistUrl(): string {
    return `https://www.youtube.com/playlist?list=${this.playlistId}`;
  }

  // ---------- Network resources ----------

  async html(): Promise<string> {
    if (this.cachedHtml) return this.cachedHtml;
    this.cachedHtml = await httpGetText(this.playlistUrl);
    return this.cachedHtml;
  }

  async ytcfg(): Promise<Record<string, unknown>> {
    if (this.cachedYtcfg) return this.cachedYtcfg;
    this.cachedYtcfg = extract.getYtcfg(await this.html());
    return this.cachedYtcfg;
  }

  async initialData(): Promise<Record<string, unknown>> {
    if (this.cachedInitialData) return this.cachedInitialData;
    this.cachedInitialData = (await extract.initialData(await this.html())) as Record<string, unknown>;
    return this.cachedInitialData;
  }

  async sidebarInfo(): Promise<unknown[]> {
    if (this.cachedSidebar) return this.cachedSidebar;
    const data = await this.initialData();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    this.cachedSidebar = (data as any).sidebar?.playlistSidebarRenderer?.items ?? [];
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return this.cachedSidebar!;
  }

  async ytApiKey(): Promise<string> {
    return String((await this.ytcfg())['INNERTUBE_API_KEY']);
  }

  // ---------- Pagination ----------

  protected async *paginate(untilWatchId?: string): AsyncGenerator<string[]> {
    let [videoUrls, continuation] = (this.constructor as typeof Playlist).extractVideos(
      JSON.stringify(await this.initialData()),
    );

    if (untilWatchId !== undefined) {
      const idx = videoUrls.indexOf(`/watch?v=${untilWatchId}`);
      if (idx !== -1) {
        yield videoUrls.slice(0, idx);
        return;
      }
    }
    yield videoUrls;

    while (continuation) {
      const req = await this.buildContinuationRequest(continuation);
      const text = await post(req.url, req.data, { headers: req.headers });
      [videoUrls, continuation] = (this.constructor as typeof Playlist).extractVideos(text);
      if (untilWatchId !== undefined) {
        const idx = videoUrls.indexOf(`/watch?v=${untilWatchId}`);
        if (idx !== -1) {
          yield videoUrls.slice(0, idx);
          return;
        }
      }
      yield videoUrls;
    }
  }

  protected async buildContinuationRequest(continuation: string): Promise<ContinuationRequest> {
    return {
      url: `https://www.youtube.com/youtubei/v1/browse?key=${await this.ytApiKey()}`,
      headers: {
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20200720.00.02',
      },
      data: {
        continuation,
        context: { client: { clientName: 'WEB', clientVersion: '2.20200720.00.02' } },
      },
    };
  }

  protected static extractVideos(rawJson: string): [string[], string | null] {
    const data = JSON.parse(rawJson) as Record<string, unknown>;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let videos: any[] | null = null;
    try {
      const sectionContents =
        (data as any).contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents;
      if (sectionContents) {
        const importantContent =
          sectionContents[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer ??
          sectionContents[1]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer;
        videos = importantContent?.contents ?? null;
      }
    } catch {
      /* fall through */
    }

    if (!videos) {
      const continuationItems =
        (data as any).onResponseReceivedActions?.[0]?.appendContinuationItemsAction
          ?.continuationItems;
      if (continuationItems) videos = continuationItems;
    }

    if (!videos) return [[], null];

    let continuation: string | null = null;
    const last = videos[videos.length - 1];
    const continuationToken =
      last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (continuationToken) {
      continuation = String(continuationToken);
      videos = videos.slice(0, -1);
    }

    const watchPaths = videos
      .map((v) => v?.playlistVideoRenderer?.videoId)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => `/watch?v=${id}`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return [uniqueify(watchPaths), continuation];
  }

  // ---------- Public iteration ----------

  async videoUrls(): Promise<string[]> {
    if (this.cachedVideoUrls) return this.cachedVideoUrls;
    const out: string[] = [];
    for await (const page of this.paginate()) {
      for (const path of page) out.push(`https://www.youtube.com${path}`);
    }
    this.cachedVideoUrls = out;
    return out;
  }

  async *videos(): AsyncGenerator<YouTube> {
    for await (const page of this.paginate()) {
      for (const path of page) yield new YouTube(`https://www.youtube.com${path}`);
    }
  }

  async length(): Promise<number> {
    return (await this.videoUrls()).length;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<YouTube> {
    yield* this.videos();
  }

  // ---------- Sidebar metadata ----------

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async title(): Promise<string | null> {
    const sidebar = (await this.sidebarInfo()) as any[];
    return sidebar[0]?.playlistSidebarPrimaryInfoRenderer?.title?.runs?.[0]?.text ?? null;
  }

  async description(): Promise<string | null> {
    const sidebar = (await this.sidebarInfo()) as any[];
    return sidebar[0]?.playlistSidebarPrimaryInfoRenderer?.description?.simpleText ?? null;
  }

  async owner(): Promise<string | null> {
    const sidebar = (await this.sidebarInfo()) as any[];
    return (
      sidebar[1]?.playlistSidebarSecondaryInfoRenderer?.videoOwner?.videoOwnerRenderer?.title
        ?.runs?.[0]?.text ?? null
    );
  }

  async ownerId(): Promise<string | null> {
    const sidebar = (await this.sidebarInfo()) as any[];
    return (
      sidebar[1]?.playlistSidebarSecondaryInfoRenderer?.videoOwner?.videoOwnerRenderer?.title
        ?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null
    );
  }

  async ownerUrl(): Promise<string | null> {
    const id = await this.ownerId();
    return id ? `https://www.youtube.com/channel/${id}` : null;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
