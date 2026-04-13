<div align="center">

# tytube

**A TypeScript port of [pytube](https://github.com/pytube/pytube). Extract YouTube metadata, list streams, and read captions — without the YouTube Data API.**

[![npm version](https://img.shields.io/npm/v/tytube?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/tytube)
[![npm downloads](https://img.shields.io/npm/dm/tytube?color=cb3837&logo=npm)](https://www.npmjs.com/package/tytube)
[![bundle size](https://img.shields.io/bundlephobia/minzip/tytube?label=minzip)](https://bundlephobia.com/package/tytube)
[![CI](https://img.shields.io/github/actions/workflow/status/hallelx2/tytube/ci.yml?branch=main&logo=github&label=CI)](https://github.com/hallelx2/tytube/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![Node](https://img.shields.io/node/v/tytube?logo=node.js&logoColor=white)](package.json)
[![Bun](https://img.shields.io/badge/Bun-ready-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![Tests](https://img.shields.io/badge/tests-45_passing-success?logo=vitest&logoColor=white)](tests)

`youtube` &nbsp;·&nbsp; `metadata` &nbsp;·&nbsp; `streams` &nbsp;·&nbsp; `captions` &nbsp;·&nbsp; `playlist` &nbsp;·&nbsp; `channel` &nbsp;·&nbsp; `search` &nbsp;·&nbsp; `no-api-key` &nbsp;·&nbsp; `pytube` &nbsp;·&nbsp; `bun` &nbsp;·&nbsp; `node` &nbsp;·&nbsp; `esm`

</div>

---

> **Status: pre-release.** Metadata extraction, stream discovery, and caption listing all work end-to-end against live YouTube. Full media downloads require a working `n`-parameter cipher against YouTube's current `base.js` and are not yet implemented in v0.1 — see [Limitations](#limitations).

## Why tytube?

Existing JS YouTube libraries either wrap a Python binary (`youtube-dl-exec`), depend on the YouTube Data API v3 (rate limits + API key required), or break under non-Node runtimes. tytube is a **pure TypeScript** rewrite of pytube's API surface that runs natively under **Bun**, has **zero runtime dependencies**, and ships **ESM + CJS + .d.ts** out of the box.

- **No Python**, no `yt-dlp` shell-out, no Data API key.
- **Zero runtime dependencies** — just `fetch` and (optionally) `node:fs`.
- **1:1 pytube API parity** — if you know pytube, you know tytube.
- **First-class Bun support** — built and tested on Bun matrix CI.
- **Strict TypeScript** with full `.d.ts` declarations and `noUncheckedIndexedAccess`.

## Install

```bash
bun add tytube     # Bun
npm install tytube # Node
pnpm add tytube    # pnpm
yarn add tytube    # Yarn
```

## Quick start

```ts
import { YouTube } from 'tytube';

const yt = new YouTube('https://youtu.be/lpFcNQpH81Q');
await yt.prefetch();

console.log(await yt.title());     // "Build a Language Learning Mobile App: …"
console.log(await yt.author());    // "Andreas Trolle"
console.log(await yt.length());    // 31126 (seconds)
console.log(await yt.views());     // 16372

const streams = await yt.streams();
console.log(`Found ${streams.length} streams`);
for (const stream of streams) {
  console.log(stream.toString());
}

const captions = await yt.captions();
for (const c of captions) {
  console.log(`${c.code}: ${c.name}`);
}
```

After `prefetch()`, the `*Sync` getters work without further I/O:

```ts
console.log(yt.titleSync);
console.log(yt.authorSync);
console.log(yt.streamsSync.length);
```

## Playlists, channels, and search

```ts
import { Playlist, Channel, Search } from 'tytube';

// Playlist iteration — async iterable, lazily paged
const playlist = new Playlist('https://www.youtube.com/playlist?list=PL...');
console.log(await playlist.title());
for await (const video of playlist) {
  console.log(await video.title());
}

// Channel videos
const channel = new Channel('https://www.youtube.com/c/SomeChannel');
console.log(await channel.channelName());
for await (const video of channel) {
  console.log(await video.title());
}

// Search results
const search = new Search('typescript tutorial');
const results = await search.results();
for (const yt of results) {
  console.log(await yt.title());
}
```

## CLI

```bash
bunx tytube https://youtu.be/lpFcNQpH81Q --list
bunx tytube https://youtu.be/lpFcNQpH81Q --list-captions
bunx tytube https://youtu.be/lpFcNQpH81Q -c en -t ./captions
bunx tytube --version
```

> Download flags (`-r`, `--itag`, `-a`, `-f`) are wired up but currently constrained by the cipher limitation below.

## API parity with pytube

All metadata getters are async because they may trigger network I/O on first call. After `prefetch()`, sync `*Sync` getters work for hot-path access.

| pytube                                  | tytube                                          |
| --------------------------------------- | ----------------------------------------------- |
| `YouTube(url)`                          | `new YouTube(url)`                              |
| `yt.title`                              | `await yt.title()` &nbsp;·&nbsp; `yt.titleSync` |
| `yt.author`                             | `await yt.author()`                             |
| `yt.length`                             | `await yt.length()`                             |
| `yt.views`                              | `await yt.views()`                              |
| `yt.streams`                            | `await yt.streams()`                            |
| `yt.captions`                           | `await yt.captions()`                           |
| `yt.thumbnail_url`                      | `await yt.thumbnailUrl()`                       |
| `yt.channel_url`                        | `await yt.channelUrl()`                         |
| `yt.publish_date`                       | `await yt.publishDate()`                        |
| `yt.metadata`                           | `await yt.metadata()`                           |
| `Playlist(url).videos`                  | `for await (const v of new Playlist(url))`     |
| `Channel(url).videos`                   | `for await (const v of new Channel(url))`      |
| `Search(q).results`                     | `await new Search(q).results()`                 |
| `stream.download(output_path=…)`        | `await stream.download({ outputPath: '…' })`   |
| `caption.generate_srt_captions()`       | `await caption.generateSrtCaptions()`           |

Filtering streams works the same way:

```ts
const streams = await yt.streams();

streams.getHighestResolution();
streams.getLowestResolution();
streams.getAudioOnly('mp4');
streams.getByItag(22);
streams.getByResolution('720p');
streams.filter({ progressive: true, subtype: 'mp4' }).orderBy('resolution').last();
streams.filter({ onlyAudio: true }).orderBy('abr').last();
```

## Runtime support

| Runtime              | Status                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| Node.js ≥18          | ✅ Full support                                                                          |
| Bun ≥1.0             | ✅ Full support — built and CI-tested on Bun                                            |
| Deno                 | ✅ Works with `--allow-net` (uses global `fetch`)                                       |
| Browser              | ⚠️ Requires a CORS proxy — YouTube does not send CORS headers                          |
| Cloudflare Workers   | ⚠️ Cipher path requires `Function()` which is blocked under default CSP                 |

## Limitations

**Media downloads currently fail with HTTP 403.** YouTube ciphers the `n` parameter on stream URLs, and decoding `n` requires running JavaScript extracted from YouTube's `base.js`. tytube's cipher extractor uses pytube's regex patterns, which YouTube's late-2025 `base.js` has drifted beyond. This is the same problem pytube has hit repeatedly — YouTube rotates `base.js` and breaks the regex.

**The metadata extraction path works completely** because it parses `ytInitialPlayerResponse` directly from the watch HTML, which doesn't depend on cipher decryption.

If you need actual media downloads today, use yt-dlp via `child_process.spawn` as a temporary bridge while we iterate on the cipher. We're tracking the cipher fix as the headline issue for v0.2.

## Contributing

```bash
git clone https://github.com/hallelx2/tytube
cd tytube
bun install
bunx vitest run    # 45 tests, all passing
bunx tsup          # build dist/
```

The package mirrors pytube's module layout 1:1 in [`src/`](src) so contributors can read both side-by-side. The Python pytube source lives in the parent directory at `../pytube/pytube/` as a read-only reference.

## Acknowledgements

- The original [pytube](https://github.com/pytube/pytube) project, whose architecture and regex patterns this port closely follows.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) for keeping the InnerTube client configurations current.

## License

[MIT](LICENSE), with portions derived from pytube (originally The Unlicense).
