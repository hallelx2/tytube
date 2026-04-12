import { describe, expect, it } from 'vitest';
import { getFormatProfile, ITAGS, PROGRESSIVE_VIDEO, DASH_AUDIO } from '../src/itags.js';

describe('itags lookup', () => {
  it('contains progressive itag 22 (720p mp4)', () => {
    expect(PROGRESSIVE_VIDEO[22]).toEqual({ resolution: '720p', abr: '192kbps' });
  });

  it('contains DASH audio itag 140', () => {
    expect(DASH_AUDIO[140]).toEqual({ resolution: null, abr: '128kbps' });
  });

  it('aggregated ITAGS includes all categories', () => {
    expect(ITAGS[22]).toBeDefined();
    expect(ITAGS[137]).toBeDefined();
    expect(ITAGS[140]).toBeDefined();
  });
});

describe('getFormatProfile', () => {
  it('flags DASH itags', () => {
    const profile = getFormatProfile(137);
    expect(profile.isDash).toBe(true);
    expect(profile.resolution).toBe('1080p');
  });

  it('flags HDR itags', () => {
    expect(getFormatProfile(334).isHdr).toBe(true);
    expect(getFormatProfile(22).isHdr).toBe(false);
  });

  it('flags 3D itags', () => {
    expect(getFormatProfile(82).is3d).toBe(true);
  });

  it('returns null fields for unknown itags', () => {
    const profile = getFormatProfile(99999);
    expect(profile.resolution).toBeNull();
    expect(profile.isDash).toBe(false);
  });
});
