import { describe, expect, it } from 'vitest';
import { Caption } from '../src/captions.js';

describe('Caption.floatToSrtTimeFormat', () => {
  it('formats whole seconds', () => {
    expect(Caption.floatToSrtTimeFormat(3)).toBe('00:00:03,000');
  });

  it('formats fractional seconds', () => {
    expect(Caption.floatToSrtTimeFormat(3.89)).toBe('00:00:03,890');
  });

  it('formats hours+minutes+seconds', () => {
    expect(Caption.floatToSrtTimeFormat(3661.5)).toBe('01:01:01,500');
  });
});

describe('Caption.xmlCaptionToSrt', () => {
  it('converts a basic transcript', () => {
    const xml = `<transcript><text start="0" dur="2.5">Hello</text><text start="2.5" dur="1">world</text></transcript>`;
    const srt = Caption.xmlCaptionToSrt(xml);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500\nHello');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:03,500\nworld');
  });

  it('decodes HTML entities', () => {
    const xml = `<transcript><text start="0" dur="1">Tom &amp; Jerry &#39;ello</text></transcript>`;
    const srt = Caption.xmlCaptionToSrt(xml);
    expect(srt).toContain("Tom & Jerry 'ello");
  });
});

describe('Caption constructor', () => {
  it('parses simpleText name', () => {
    const c = new Caption({ baseUrl: 'http://x', name: { simpleText: 'English' }, vssId: '.en' });
    expect(c.name).toBe('English');
    expect(c.code).toBe('en');
  });

  it('parses runs name and strips leading dots from vssId', () => {
    const c = new Caption({
      baseUrl: 'http://x',
      name: { runs: [{ text: 'English (auto-generated)' }] },
      vssId: 'a.en',
    });
    expect(c.name).toBe('English (auto-generated)');
    expect(c.code).toBe('a.en');
  });
});
