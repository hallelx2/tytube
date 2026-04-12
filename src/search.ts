// YouTube search interface. Mirrors pytube/contrib/search.py.

import { InnerTube } from './innertube.js';
import { YouTube } from './youtube.js';

export class Search {
  readonly query: string;
  private readonly innertube: InnerTube;
  private cachedResults: YouTube[] | null = null;
  private currentContinuation: string | null = null;
  private initialResults: Record<string, unknown> | null = null;

  constructor(query: string) {
    this.query = query;
    this.innertube = new InnerTube({ client: 'WEB' });
  }

  async results(): Promise<YouTube[]> {
    if (this.cachedResults) return this.cachedResults;
    const [videos, continuation] = await this.fetchAndParse();
    this.cachedResults = videos;
    this.currentContinuation = continuation;
    return videos;
  }

  /** Fetch the next page of results and append to the cached results array. */
  async getNextResults(): Promise<void> {
    if (!this.cachedResults) {
      await this.results();
      return;
    }
    if (!this.currentContinuation) {
      throw new Error('No further results available.');
    }
    const [videos, continuation] = await this.fetchAndParse(this.currentContinuation);
    this.cachedResults.push(...videos);
    this.currentContinuation = continuation;
  }

  async completionSuggestions(): Promise<string[] | null> {
    if (!this.initialResults) await this.results();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    return ((this.initialResults as any)?.refinements ?? null) as string[] | null;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  async fetchAndParse(continuation?: string): Promise<[YouTube[], string | null]> {
    const raw = (await this.innertube.search<Record<string, unknown>>(this.query, continuation)) as Record<
      string,
      unknown
    >;
    if (!this.initialResults) this.initialResults = raw;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    let sections: any[] | null = null;
    try {
      sections =
        (raw as any).contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
          ?.contents ?? null;
    } catch {
      sections = null;
    }
    if (!sections) {
      sections =
        (raw as any).onResponseReceivedCommands?.[0]?.appendContinuationItemsAction
          ?.continuationItems ?? null;
    }
    if (!sections) return [[], null];

    let itemRenderer: any = null;
    let continuationRenderer: any = null;
    for (const s of sections) {
      if (s?.itemSectionRenderer) itemRenderer = s.itemSectionRenderer;
      if (s?.continuationItemRenderer) continuationRenderer = s.continuationItemRenderer;
    }

    const nextContinuation =
      continuationRenderer?.continuationEndpoint?.continuationCommand?.token ?? null;

    if (!itemRenderer) return [[], nextContinuation];

    const videos: YouTube[] = [];
    for (const detail of itemRenderer.contents ?? []) {
      if (detail?.searchPyvRenderer?.ads) continue;
      if (detail?.shelfRenderer) continue;
      if (detail?.radioRenderer) continue;
      if (detail?.playlistRenderer) continue;
      if (detail?.channelRenderer) continue;
      if (detail?.horizontalCardListRenderer) continue;
      if (detail?.didYouMeanRenderer) continue;
      if (detail?.backgroundPromoRenderer) continue;
      if (!detail?.videoRenderer) continue;

      const vr = detail.videoRenderer;
      const vidId = vr.videoId as string;
      videos.push(new YouTube(`https://www.youtube.com/watch?v=${vidId}`));
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return [videos, nextContinuation];
  }
}
