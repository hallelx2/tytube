// YouTubeMetadata — parses the metadata rows from initial_data.

interface MetadataRow {
  title?: { simpleText?: string };
  contents?: Array<{ simpleText?: string; runs?: Array<{ text: string }> }>;
  hasDividerLine?: boolean;
}

export class YouTubeMetadata implements Iterable<Record<string, string>> {
  private readonly raw: MetadataRow[];
  private readonly groups: Record<string, string>[];

  constructor(rawRows: MetadataRow[]) {
    this.raw = rawRows;
    const groups: Record<string, string>[] = [{}];

    for (const el of rawRows) {
      const title = el.title?.simpleText;
      if (!title) continue;
      const contents = el.contents?.[0];
      if (!contents) continue;
      const value = contents.simpleText ?? contents.runs?.[0]?.text;
      if (value === undefined) continue;
      groups[groups.length - 1]![title] = value;
      if (el.hasDividerLine) groups.push({});
    }

    if (groups.length > 0 && Object.keys(groups[groups.length - 1]!).length === 0) {
      groups.pop();
    }
    this.groups = groups;
  }

  get rawMetadata(): MetadataRow[] {
    return this.raw;
  }

  get metadata(): Record<string, string>[] {
    return this.groups;
  }

  at(index: number): Record<string, string> | undefined {
    return this.groups[index];
  }

  [Symbol.iterator](): Iterator<Record<string, string>> {
    return this.groups[Symbol.iterator]();
  }

  toJSON(): Record<string, string>[] {
    return this.groups;
  }

  toString(): string {
    return JSON.stringify(this.groups);
  }
}
