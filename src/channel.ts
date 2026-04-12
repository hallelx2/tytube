// YouTube channel loader. Mirrors pytube/contrib/channel.py.
// Extends Playlist; the only behavioral difference is the videos endpoint and
// the gridRenderer JSON shape.

import * as extract from './extract.js';
import { uniqueify } from './helpers.js';
import { get as httpGetText } from './request.js';
import { Playlist } from './playlist.js';

export class Channel extends Playlist {
  readonly channelUri: string;
  readonly channelUrl: string;
  readonly videosUrl: string;
  readonly playlistsUrl: string;
  readonly communityUrl: string;
  readonly featuredChannelsUrl: string;
  readonly aboutUrl: string;

  private cachedVideosHtml: string | null = null;

  constructor(url: string) {
    super(url);
    this.channelUri = extract.channelName(url);
    this.channelUrl = `https://www.youtube.com${this.channelUri}`;
    this.videosUrl = `${this.channelUrl}/videos`;
    this.playlistsUrl = `${this.channelUrl}/playlists`;
    this.communityUrl = `${this.channelUrl}/community`;
    this.featuredChannelsUrl = `${this.channelUrl}/channels`;
    this.aboutUrl = `${this.channelUrl}/about`;
  }

  override async html(): Promise<string> {
    if (this.cachedVideosHtml) return this.cachedVideosHtml;
    this.cachedVideosHtml = await httpGetText(this.videosUrl);
    return this.cachedVideosHtml;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async channelName(): Promise<string | null> {
    const data = (await this.initialData()) as any;
    return data?.metadata?.channelMetadataRenderer?.title ?? null;
  }

  async channelId(): Promise<string | null> {
    const data = (await this.initialData()) as any;
    return data?.metadata?.channelMetadataRenderer?.externalId ?? null;
  }

  async vanityUrl(): Promise<string | null> {
    const data = (await this.initialData()) as any;
    return data?.metadata?.channelMetadataRenderer?.vanityChannelUrl ?? null;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  protected static override extractVideos(rawJson: string): [string[], string | null] {
    const data = JSON.parse(rawJson) as Record<string, unknown>;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let videos: any[] | null = null;
    try {
      videos =
        (data as any).contents?.twoColumnBrowseResultsRenderer?.tabs?.[1]?.tabRenderer?.content
          ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.gridRenderer
          ?.items ?? null;
    } catch {
      videos = null;
    }

    if (!videos) {
      videos =
        (data as any)[1]?.response?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction
          ?.continuationItems ??
        (data as any).onResponseReceivedActions?.[0]?.appendContinuationItemsAction
          ?.continuationItems ??
        null;
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
      .map((v) => v?.gridVideoRenderer?.videoId)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => `/watch?v=${id}`);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    return [uniqueify(watchPaths), continuation];
  }
}
