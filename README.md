# tytube

A TypeScript port of [pytube](https://github.com/pytube/pytube). Extract YouTube video metadata, list streams, and read captions **without** the YouTube Data API v3. Pure TypeScript, dependency-light, works natively in **Node 18+**, **Bun**, and the **browser** (with a CORS proxy).

> **Status: pre-release.** Metadata extraction and stream discovery work today. Full media downloads require a working `n`-parameter cipher against YouTube's current `base.js` and are not yet implemented in v0.1 — see [Limitations](#limitations) below.

## Why tytube?

- No Python binary, no `yt-dlp` shell-out, no Data API key.
- Pure TypeScript, ESM-first, zero runtime dependencies.
- Mirrors pytube's API surface — if you know pytube, you know tytube.
- Works natively under **Bun** (the main reason this exists — `youtube-dl-exec` and similar libs break under non-Node runtimes).

## Install

```bash
bun add tytube
# or
npm install tytube
# or
pnpm add tytube
```

## Quick start

```ts
import { YouTube } from 'tytube';

const yt = new YouTube('https://youtu.be/lpFcNQpH81Q');
await yt.prefetch();

console.log(await yt.title());
console.log(await yt.author());
console.log(await yt.length(), 'seconds');

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

// Playlist iteration
const playlist = new Playlist('https://www.youtube.com/playlist?list=PL...');
for await (const video of playlist) {
  console.log(await video.title());
}

// Channel videos
const channel = new Channel('https://www.youtube.com/c/SomeChannel');
console.log(await channel.channelName());
for await (const video of channel) {
  console.log(await video.title());
}

// Search
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
```

> Download flags (`-r`, `--itag`, `-a`, `-f`) are wired up but currently constrained by the cipher limitation below.

## API surface

Mirrors pytube 1:1. All metadata getters are async because they may trigger network I/O on first call:

| pytube | tytube |
|---|---|
| `YouTube(url)` | `new YouTube(url)` |
| `yt.title` | `await yt.title()` |
| `yt.author` | `await yt.author()` |
| `yt.length` | `await yt.length()` |
| `yt.views` | `await yt.views()` |
| `yt.streams` | `await yt.streams()` |
| `yt.captions` | `await yt.captions()` |
| `yt.thumbnail_url` | `await yt.thumbnailUrl()` |
| `yt.channel_url` | `await yt.channelUrl()` |
| `yt.publish_date` | `await yt.publishDate()` |
| `yt.metadata` | `await yt.metadata()` |
| `Playlist(url).videos` | `for await (const v of new Playlist(url))` |
| `Channel(url).videos` | `for await (const v of new Channel(url))` |
| `Search(q).results` | `await new Search(q).results()` |

## Limitations

**Media downloads currently fail with HTTP 403.** YouTube ciphers the `n` parameter on stream URLs, and decoding `n` requires running JavaScript extracted from YouTube's `base.js`. tytube's cipher extractor uses pytube's regex patterns, which YouTube's late-2025 `base.js` has drifted beyond. This is the same problem pytube has hit repeatedly — YouTube rotates `base.js` and breaks the regex.

**The metadata extraction path works completely** because it parses `ytInitialPlayerResponse` directly from the watch HTML, which doesn't depend on cipher decryption.

If you need actual media downloads today, use yt-dlp via `child_process.spawn` as a temporary bridge while we iterate on the cipher. We're tracking the cipher fix as the headline issue for v0.2.

## Runtime support

| Runtime | Status |
|---|---|
| Node.js ≥18 | ✅ |
| Bun ≥1.0 | ✅ |
| Deno | ✅ (with `--allow-net`) |
| Browser | ⚠️ Requires a CORS proxy — YouTube does not send CORS headers |
| Cloudflare Workers | ⚠️ Cipher path requires `Function()` which is blocked under default CSP |

## License

MIT, with portions derived from pytube (originally The Unlicense).
