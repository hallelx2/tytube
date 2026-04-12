// Caption track container. Mirrors pytube/captions.py.
// Includes a tiny self-contained XML reader so the package doesn't need
// xmldom or any other DOM polyfill — works on every JS runtime.

import { safeFilename } from './helpers.js';
import { get as httpGetText } from './request.js';
import { ensureDir, writeText } from './runtime/fs.js';
import { joinPath, resolveOutputDir } from './runtime/path.js';

export interface RawCaptionTrack {
  baseUrl: string;
  name?: { simpleText?: string; runs?: Array<{ text: string }> };
  vssId?: string;
  languageCode?: string;
}

export class Caption {
  readonly url: string;
  readonly name: string;
  readonly code: string;

  constructor(track: RawCaptionTrack) {
    this.url = track.baseUrl;
    if (track.name?.simpleText) {
      this.name = track.name.simpleText;
    } else if (track.name?.runs) {
      this.name = track.name.runs.find((r) => r.text)?.text ?? '';
    } else {
      this.name = '';
    }
    // pytube uses vssId for language code (handles auto-generated tracks)
    this.code = (track.vssId ?? track.languageCode ?? '').replace(/^\.+/, '');
  }

  async xmlCaptions(): Promise<string> {
    return httpGetText(this.url);
  }

  async jsonCaptions(): Promise<unknown> {
    const url = this.url.replace('fmt=srv3', 'fmt=json3');
    const text = await httpGetText(url);
    return JSON.parse(text);
  }

  async generateSrtCaptions(): Promise<string> {
    return Caption.xmlCaptionToSrt(await this.xmlCaptions());
  }

  static floatToSrtTimeFormat(d: number): string {
    const whole = Math.floor(d);
    const fraction = d - whole;
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    const ms = String(Math.round(fraction * 1000)).padStart(3, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${ms}`;
  }

  static xmlCaptionToSrt(xml: string): string {
    const segments: string[] = [];
    let i = 0;
    let seq = 1;
    // Match every <text start="..." dur="...">…</text> entry.
    const re = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const attrs = match[1] ?? '';
      const rawText = match[2] ?? '';
      const startMatch = /\bstart\s*=\s*"([^"]+)"/.exec(attrs);
      const durMatch = /\bdur\s*=\s*"([^"]+)"/.exec(attrs);
      if (!startMatch) continue;
      const start = parseFloat(startMatch[1]!);
      const dur = durMatch ? parseFloat(durMatch[1]!) : 0;
      const end = start + dur;
      const text = decodeXmlEntities(rawText.replace(/\n/g, ' ').replace(/  +/g, ' '));
      segments.push(
        `${seq}\n${Caption.floatToSrtTimeFormat(start)} --> ${Caption.floatToSrtTimeFormat(end)}\n${text}\n`,
      );
      seq++;
      i++;
    }
    return segments.join('\n').trim();
  }

  /**
   * Write the caption track to disk as SRT or XML.
   * Returns the absolute path of the written file.
   */
  async download(
    title: string,
    opts: { srt?: boolean; outputPath?: string; filenamePrefix?: string } = {},
  ): Promise<string> {
    const srt = opts.srt ?? true;
    let stem = title;
    if (stem.endsWith('.srt') || stem.endsWith('.xml')) {
      stem = stem.split('.').slice(0, -1).join('.');
    }
    if (opts.filenamePrefix) stem = `${safeFilename(opts.filenamePrefix)}${stem}`;
    stem = safeFilename(stem);
    stem += ` (${this.code})`;
    stem += srt ? '.srt' : '.xml';

    const dir = await resolveOutputDir(opts.outputPath);
    await ensureDir(dir);
    const filePath = joinPath(dir, stem);
    const contents = srt ? await this.generateSrtCaptions() : await this.xmlCaptions();
    await writeText(filePath, contents);
    return filePath;
  }

  toString(): string {
    return `<Caption lang="${this.name}" code="${this.code}">`;
  }
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}
