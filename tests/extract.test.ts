import { describe, expect, it } from 'vitest';
import {
  channelName,
  isAgeRestricted,
  isPrivate,
  mimeTypeCodec,
  playlistId,
  videoId,
} from '../src/extract.js';

describe('videoId', () => {
  it('extracts from /watch?v=', () => {
    expect(videoId('https://www.youtube.com/watch?v=2lAe1cqCOXo')).toBe('2lAe1cqCOXo');
  });

  it('extracts from youtu.be short link', () => {
    expect(videoId('https://youtu.be/2lAe1cqCOXo')).toBe('2lAe1cqCOXo');
  });

  it('extracts from /embed/', () => {
    expect(videoId('https://www.youtube.com/embed/2lAe1cqCOXo')).toBe('2lAe1cqCOXo');
  });
});

describe('playlistId', () => {
  it('extracts from list query param', () => {
    expect(playlistId('https://www.youtube.com/playlist?list=PL12345')).toBe('PL12345');
  });
});

describe('channelName', () => {
  it('extracts /c/<name>', () => {
    expect(channelName('https://www.youtube.com/c/SomeChannel/videos')).toBe('/c/SomeChannel');
  });
  it('extracts /channel/<id>', () => {
    expect(channelName('https://www.youtube.com/channel/UCabc123')).toBe('/channel/UCabc123');
  });
});

describe('mimeTypeCodec', () => {
  it('parses single-codec mime type', () => {
    const { mimeType, codecs } = mimeTypeCodec('audio/webm; codecs="opus"');
    expect(mimeType).toBe('audio/webm');
    expect(codecs).toEqual(['opus']);
  });

  it('parses multi-codec mime type', () => {
    const { mimeType, codecs } = mimeTypeCodec('video/webm; codecs="vp8, vorbis"');
    expect(mimeType).toBe('video/webm');
    expect(codecs).toEqual(['vp8', 'vorbis']);
  });
});

describe('predicates', () => {
  it('detects age-restricted html', () => {
    expect(isAgeRestricted('<meta property="og:restrictions:age" content="18+">')).toBe(true);
    expect(isAgeRestricted('<html></html>')).toBe(false);
  });

  it('detects private videos', () => {
    expect(isPrivate('"simpleText":"Private video"')).toBe(true);
    expect(isPrivate('public html')).toBe(false);
  });
});
