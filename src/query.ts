// Query interface for media streams and captions. Mirrors pytube/query.py.

import type { Caption } from './captions.js';
import { Stream } from './stream.js';

export type StreamPredicate = (s: Stream) => boolean;

export interface FilterCriteria {
  fps?: number;
  res?: string | string[];
  resolution?: string | string[];
  mimeType?: string;
  type?: string;
  subtype?: string;
  fileExtension?: string;
  abr?: string;
  bitrate?: string;
  videoCodec?: string;
  audioCodec?: string;
  onlyAudio?: boolean;
  onlyVideo?: boolean;
  progressive?: boolean;
  adaptive?: boolean;
  isDash?: boolean;
  customFilters?: StreamPredicate[];
}

export class StreamQuery implements Iterable<Stream> {
  readonly fmtStreams: Stream[];
  private readonly itagIndex: Map<number, Stream>;

  constructor(fmtStreams: Stream[]) {
    this.fmtStreams = fmtStreams;
    this.itagIndex = new Map(fmtStreams.map((s) => [s.itag, s]));
  }

  filter(criteria: FilterCriteria = {}): StreamQuery {
    const filters: StreamPredicate[] = [];
    const resolution = criteria.res ?? criteria.resolution;
    if (resolution) {
      if (Array.isArray(resolution)) {
        filters.push((s) => s.resolution !== null && resolution.includes(s.resolution));
      } else {
        filters.push((s) => s.resolution === resolution);
      }
    }
    if (criteria.fps !== undefined) filters.push((s) => s.fps === criteria.fps);
    if (criteria.mimeType !== undefined) filters.push((s) => s.mimeType === criteria.mimeType);
    if (criteria.type !== undefined) filters.push((s) => s.type === criteria.type);
    const subtype = criteria.subtype ?? criteria.fileExtension;
    if (subtype !== undefined) filters.push((s) => s.subtype === subtype);
    const abr = criteria.abr ?? criteria.bitrate;
    if (abr !== undefined) filters.push((s) => s.abr === abr);
    if (criteria.videoCodec !== undefined) filters.push((s) => s.videoCodec === criteria.videoCodec);
    if (criteria.audioCodec !== undefined) filters.push((s) => s.audioCodec === criteria.audioCodec);
    if (criteria.onlyAudio) filters.push((s) => s.includesAudioTrack && !s.includesVideoTrack);
    if (criteria.onlyVideo) filters.push((s) => s.includesVideoTrack && !s.includesAudioTrack);
    if (criteria.progressive) filters.push((s) => s.isProgressive);
    if (criteria.adaptive) filters.push((s) => s.isAdaptive);
    if (criteria.isDash !== undefined) filters.push((s) => s.isDash === criteria.isDash);
    if (criteria.customFilters) filters.push(...criteria.customFilters);

    return this.applyFilters(filters);
  }

  private applyFilters(filters: StreamPredicate[]): StreamQuery {
    let result = this.fmtStreams;
    for (const f of filters) result = result.filter(f);
    return new StreamQuery(result);
  }

  /**
   * Sort by an attribute. Filters out streams that don't have it. For string
   * attributes (e.g., "720p"), sorts by the embedded integer.
   */
  orderBy(attribute: keyof Stream): StreamQuery {
    const present = this.fmtStreams.filter((s) => s[attribute] !== null && s[attribute] !== undefined);
    if (present.length === 0) return new StreamQuery(present);

    const first = present[0]![attribute];
    if (typeof first === 'string') {
      try {
        const sorted = [...present].sort((a, b) => {
          const va = parseInt(String(a[attribute]).replace(/\D/g, ''), 10);
          const vb = parseInt(String(b[attribute]).replace(/\D/g, ''), 10);
          if (Number.isNaN(va) || Number.isNaN(vb)) throw new Error('non-numeric');
          return va - vb;
        });
        return new StreamQuery(sorted);
      } catch {
        // fall through to lexicographic
      }
    }
    const sorted = [...present].sort((a, b) => {
      const va = a[attribute] as unknown as number | string;
      const vb = b[attribute] as unknown as number | string;
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return new StreamQuery(sorted);
  }

  desc(): StreamQuery {
    return new StreamQuery([...this.fmtStreams].reverse());
  }

  asc(): StreamQuery {
    return this;
  }

  getByItag(itag: number): Stream | undefined {
    return this.itagIndex.get(itag);
  }

  getByResolution(resolution: string): Stream | undefined {
    return this.filter({ progressive: true, subtype: 'mp4', resolution }).first();
  }

  getLowestResolution(): Stream | undefined {
    return this.filter({ progressive: true, subtype: 'mp4' }).orderBy('resolution').first();
  }

  getHighestResolution(): Stream | undefined {
    return this.filter({ progressive: true }).orderBy('resolution').last();
  }

  getAudioOnly(subtype = 'mp4'): Stream | undefined {
    return this.filter({ onlyAudio: true, subtype }).orderBy('abr').last();
  }

  otf(isOtf = false): StreamQuery {
    return this.applyFilters([(s) => s.isOtf === isOtf]);
  }

  first(): Stream | undefined {
    return this.fmtStreams[0];
  }

  last(): Stream | undefined {
    return this.fmtStreams[this.fmtStreams.length - 1];
  }

  get length(): number {
    return this.fmtStreams.length;
  }

  at(index: number): Stream | undefined {
    return this.fmtStreams[index];
  }

  toArray(): Stream[] {
    return [...this.fmtStreams];
  }

  [Symbol.iterator](): Iterator<Stream> {
    return this.fmtStreams[Symbol.iterator]();
  }
}

export class CaptionQuery implements Iterable<Caption> {
  private readonly index: Map<string, Caption>;

  constructor(captions: Caption[]) {
    this.index = new Map(captions.map((c) => [c.code, c]));
  }

  get(langCode: string): Caption | undefined {
    return this.index.get(langCode);
  }

  has(langCode: string): boolean {
    return this.index.has(langCode);
  }

  get length(): number {
    return this.index.size;
  }

  toArray(): Caption[] {
    return [...this.index.values()];
  }

  [Symbol.iterator](): Iterator<Caption> {
    return this.index.values();
  }
}
