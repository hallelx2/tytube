// Library-specific exception definitions. Mirrors pytube/exceptions.py.

export class PytubeError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'PytubeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MaxRetriesExceeded extends PytubeError {
  constructor(message = 'Maximum number of retries exceeded') {
    super(message);
    this.name = 'MaxRetriesExceeded';
  }
}

export class HTMLParseError extends PytubeError {
  constructor(message = 'HTML could not be parsed') {
    super(message);
    this.name = 'HTMLParseError';
  }
}

export class ExtractError extends PytubeError {
  constructor(message = 'Data extraction failed') {
    super(message);
    this.name = 'ExtractError';
  }
}

export class RegexMatchError extends ExtractError {
  readonly caller: string;
  readonly pattern: string | RegExp;

  constructor(caller: string, pattern: string | RegExp) {
    super(`${caller}: could not find match for ${pattern}`);
    this.name = 'RegexMatchError';
    this.caller = caller;
    this.pattern = pattern;
  }
}

export class VideoUnavailable extends PytubeError {
  readonly videoId: string;

  constructor(videoId: string, message?: string) {
    super(message ?? `${videoId} is unavailable`);
    this.name = 'VideoUnavailable';
    this.videoId = videoId;
  }
}

export class AgeRestrictedError extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} is age restricted, and can't be accessed without logging in.`);
    this.name = 'AgeRestrictedError';
  }
}

export class LiveStreamError extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} is streaming live and cannot be loaded`);
    this.name = 'LiveStreamError';
  }
}

export class VideoPrivate extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} is a private video`);
    this.name = 'VideoPrivate';
  }
}

export class RecordingUnavailable extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} does not have a live stream recording available`);
    this.name = 'RecordingUnavailable';
  }
}

export class MembersOnly extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} is a members-only video`);
    this.name = 'MembersOnly';
  }
}

export class VideoRegionBlocked extends VideoUnavailable {
  constructor(videoId: string) {
    super(videoId, `${videoId} is not available in your region`);
    this.name = 'VideoRegionBlocked';
  }
}
