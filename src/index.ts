// tytube — a TypeScript port of pytube.
//
// Public API. Mirrors `from pytube import ...`.

export { YouTube } from './youtube.js';
export type { YouTubeOptions } from './youtube.js';
export { Stream } from './stream.js';
export type { DownloadOptions, SharedState } from './stream.js';
export { StreamQuery, CaptionQuery } from './query.js';
export type { FilterCriteria, StreamPredicate } from './query.js';
export { Caption } from './captions.js';
export type { RawCaptionTrack } from './captions.js';
export { Playlist } from './playlist.js';
export { Channel } from './channel.js';
export { Search } from './search.js';
export { YouTubeMetadata } from './metadata.js';
export { InnerTube } from './innertube.js';
export type { InnerTubeOptions, InnerTubeClientName } from './innertube.js';
export {
  PROGRESSIVE_VIDEO,
  DASH_VIDEO,
  DASH_AUDIO,
  ITAGS,
  getFormatProfile,
} from './itags.js';
export type { ItagInfo, FormatProfile } from './itags.js';
export {
  PytubeError,
  MaxRetriesExceeded,
  HTMLParseError,
  ExtractError,
  RegexMatchError,
  VideoUnavailable,
  AgeRestrictedError,
  LiveStreamError,
  VideoPrivate,
  RecordingUnavailable,
  MembersOnly,
  VideoRegionBlocked,
} from './exceptions.js';
export { VERSION } from './version.js';
