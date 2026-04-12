// tytube CLI — yt-dlp-style command line interface. Mirrors pytube/cli.py.

import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import * as exceptions from './exceptions.js';
import { safeFilename } from './helpers.js';
import { Playlist } from './playlist.js';
import { fileExists } from './runtime/fs.js';
import { joinPath, resolveOutputDir } from './runtime/path.js';
import type { Stream } from './stream.js';
import { VERSION } from './version.js';
import { YouTube } from './youtube.js';

interface CliArgs {
  url: string | null;
  itag: number | null;
  resolution: string | null;
  list: boolean;
  caption: string | null;
  listCaptions: boolean;
  target: string | null;
  audio: string | null; // 'mp4' default if flag passed without arg
  ffmpeg: string | null; // 'best' default if flag passed without arg
  buildPlaybackReport: boolean;
  verbose: boolean;
  version: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    url: null,
    itag: null,
    resolution: null,
    list: false,
    caption: null,
    listCaptions: false,
    target: null,
    audio: null,
    ffmpeg: null,
    buildPlaybackReport: false,
    verbose: false,
    version: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) break;
    const next = (): string | null => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) return null;
      i++;
      return v;
    };
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--version':
        args.version = true;
        break;
      case '--itag': {
        const v = next();
        if (v) args.itag = parseInt(v, 10);
        break;
      }
      case '-r':
      case '--resolution':
        args.resolution = next();
        break;
      case '-l':
      case '--list':
        args.list = true;
        break;
      case '-v':
      case '--verbose':
        args.verbose = true;
        break;
      case '-c':
      case '--caption-code':
        args.caption = next();
        break;
      case '-lc':
      case '--list-captions':
        args.listCaptions = true;
        break;
      case '-t':
      case '--target':
        args.target = next();
        break;
      case '-a':
      case '--audio':
        args.audio = next() ?? 'mp4';
        break;
      case '-f':
      case '--ffmpeg':
        args.ffmpeg = next() ?? 'best';
        break;
      case '--build-playback-report':
        args.buildPlaybackReport = true;
        break;
      default:
        if (!arg.startsWith('-') && args.url === null) args.url = arg;
        break;
    }
    i++;
  }
  return args;
}

function printHelp(): void {
  const help = `tytube — download YouTube videos without the Data API.

Usage:
  tytube <url> [options]

Options:
  -h, --help                Show this help and exit
      --version             Print version and exit
      --itag <int>          Download stream with the given itag
  -r, --resolution <res>    Download stream with the given resolution (e.g. 720p)
  -l, --list                List available streams
  -c, --caption-code <code> Download SRT captions for the given language code
  -lc, --list-captions      List available caption codes
  -t, --target <dir>        Output directory (default: cwd)
  -a, --audio [format]      Download highest-bitrate audio (default mp4)
  -f, --ffmpeg [res]        Download video+audio and mux with ffmpeg (default best)
      --build-playback-report  Save html/js/vid_info to disk for debugging
  -v, --verbose             Verbose logging
`;
  process.stdout.write(help);
}

function displayProgressBar(received: number, filesize: number, ch = '█', scale = 0.55): void {
  const columns = (process.stdout.columns ?? 80) as number;
  const maxWidth = Math.max(10, Math.floor(columns * scale));
  const filled = Math.round((maxWidth * received) / filesize);
  const bar = ch.repeat(filled) + ' '.repeat(maxWidth - filled);
  const percent = ((100 * received) / filesize).toFixed(1);
  process.stdout.write(` ↳ |${bar}| ${percent}%\r`);
}

function attachProgress(yt: YouTube): void {
  yt.registerOnProgressCallback((stream, _chunk, bytesRemaining) => {
    void (async () => {
      const total = await stream.filesize();
      displayProgressBar(total - bytesRemaining, total);
    })();
  });
}

async function downloadStream(stream: Stream, target: string | null, filename?: string): Promise<void> {
  const sizeMb = Math.floor((await stream.filesize()) / 1048576);
  process.stdout.write(`${filename ?? stream.defaultFilename} | ${sizeMb} MB\n`);
  const filePath = await stream.getFilePath({ filename, outputPath: target ?? undefined });
  if (await stream.existsAtPath(filePath)) {
    process.stdout.write(`Already downloaded at:\n${filePath}\n`);
    return;
  }
  await stream.download({ filename, outputPath: target ?? undefined });
  process.stdout.write('\n');
}

async function displayStreams(yt: YouTube): Promise<void> {
  const streams = await yt.streams();
  for (const s of streams) process.stdout.write(`${s.toString()}\n`);
}

async function listCaptions(yt: YouTube): Promise<void> {
  const captions = await yt.captions();
  const codes = [...captions].map((c) => c.code).join(', ');
  process.stdout.write(`Available caption codes are: ${codes}\n`);
}

async function downloadByItag(yt: YouTube, itag: number, target: string | null): Promise<void> {
  const streams = await yt.streams();
  const stream = streams.getByItag(itag);
  if (!stream) {
    process.stdout.write(`Could not find a stream with itag: ${itag}\nTry one of these:\n`);
    await displayStreams(yt);
    process.exit(1);
  }
  attachProgress(yt);
  await downloadStream(stream, target);
}

async function downloadByResolution(yt: YouTube, resolution: string, target: string | null): Promise<void> {
  const streams = await yt.streams();
  const stream = streams.getByResolution(resolution);
  if (!stream) {
    process.stdout.write(`Could not find a stream with resolution: ${resolution}\nTry one of these:\n`);
    await displayStreams(yt);
    process.exit(1);
  }
  attachProgress(yt);
  await downloadStream(stream, target);
}

async function downloadHighest(yt: YouTube, target: string | null): Promise<void> {
  attachProgress(yt);
  try {
    const streams = await yt.streams();
    const stream = streams.getHighestResolution();
    if (!stream) {
      process.stdout.write('No highest-resolution progressive stream available.\n');
      return;
    }
    await downloadStream(stream, target);
  } catch (err) {
    if (err instanceof exceptions.VideoUnavailable) {
      process.stdout.write(`No video streams available: ${err.message}\n`);
    } else {
      throw err;
    }
  }
}

async function downloadAudio(yt: YouTube, filetype: string, target: string | null): Promise<void> {
  const streams = await yt.streams();
  const audio = streams.filter({ onlyAudio: true, subtype: filetype }).orderBy('abr').last();
  if (!audio) {
    process.stdout.write('No audio only stream found. Try one of these:\n');
    await displayStreams(yt);
    process.exit(1);
  }
  attachProgress(yt);
  await downloadStream(audio, target);
}

async function downloadCaption(yt: YouTube, langCode: string, target: string | null): Promise<void> {
  const captions = await yt.captions();
  const caption = captions.get(langCode);
  if (!caption) {
    process.stdout.write(`Unable to find caption with code: ${langCode}\n`);
    await listCaptions(yt);
    return;
  }
  const path = await caption.download(await yt.title(), { outputPath: target ?? undefined });
  process.stdout.write(`Saved caption file to: ${path}\n`);
}

async function ffmpegProcess(yt: YouTube, resolution: string, target: string | null): Promise<void> {
  attachProgress(yt);
  const targetDir = await resolveOutputDir(target ?? undefined);
  const streams = await yt.streams();

  let videoStream: Stream | undefined;
  if (resolution === 'best') {
    const highest = streams.filter({ progressive: false }).orderBy('resolution').last();
    const mp4 = streams.filter({ progressive: false, subtype: 'mp4' }).orderBy('resolution').last();
    videoStream = highest && mp4 && highest.resolution === mp4.resolution ? mp4 : highest;
  } else {
    videoStream =
      streams.filter({ progressive: false, resolution, subtype: 'mp4' }).first() ??
      streams.filter({ progressive: false, resolution }).first();
  }
  if (!videoStream) {
    process.stdout.write(`Could not find a stream with resolution: ${resolution}\nTry one of these:\n`);
    await displayStreams(yt);
    process.exit(1);
  }

  let audioStream = streams.getAudioOnly(videoStream.subtype);
  if (!audioStream) {
    audioStream = streams.filter({ onlyAudio: true }).orderBy('abr').last();
  }
  if (!audioStream) {
    process.stdout.write('Could not find an audio only stream\n');
    process.exit(1);
  }

  const title = safeFilename(await yt.title());
  const videoName = await uniqueName(title, videoStream.subtype, 'video', targetDir);
  const audioName = await uniqueName(title, audioStream.subtype, 'audio', targetDir);
  await downloadStream(videoStream, targetDir, videoName);
  process.stdout.write('Loading audio...\n');
  await downloadStream(audioStream, targetDir, audioName);

  const videoPath = joinPath(targetDir, `${videoName}.${videoStream.subtype}`);
  const audioPath = joinPath(targetDir, `${audioName}.${audioStream.subtype}`);
  const finalPath = joinPath(targetDir, `${title}.${videoStream.subtype}`);

  await runFfmpeg(['-i', videoPath, '-i', audioPath, '-codec', 'copy', finalPath]);
  await unlink(videoPath);
  await unlink(audioPath);
  process.stdout.write(`Wrote: ${finalPath}\n`);
}

async function uniqueName(base: string, subtype: string, mediaType: string, targetDir: string): Promise<string> {
  let counter = 0;
  while (true) {
    const fileName = `${base}_${mediaType}_${counter}`;
    const filePath = joinPath(targetDir, `${fileName}.${subtype}`);
    if (!(await fileExists(filePath))) return fileName;
    counter++;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: 'inherit' });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function performArgsOnYouTube(yt: YouTube, args: CliArgs): Promise<void> {
  const onlyUrl =
    !args.list &&
    !args.listCaptions &&
    args.itag === null &&
    args.caption === null &&
    args.resolution === null &&
    args.audio === null &&
    args.ffmpeg === null &&
    !args.buildPlaybackReport;
  if (onlyUrl) {
    await downloadHighest(yt, args.target);
    return;
  }
  if (args.listCaptions) await listCaptions(yt);
  if (args.list) await displayStreams(yt);
  if (args.itag !== null) await downloadByItag(yt, args.itag, args.target);
  if (args.caption !== null) await downloadCaption(yt, args.caption, args.target);
  if (args.resolution !== null) await downloadByResolution(yt, args.resolution, args.target);
  if (args.audio !== null) await downloadAudio(yt, args.audio, args.target);
  if (args.ffmpeg !== null) await ffmpegProcess(yt, args.ffmpeg, args.target);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    process.stdout.write(`tytube ${VERSION}\n`);
    return;
  }
  if (!args.url || !args.url.includes('youtu')) {
    printHelp();
    process.exit(1);
  }

  if (args.url.includes('/playlist')) {
    process.stdout.write('Loading playlist...\n');
    const playlist = new Playlist(args.url);
    if (!args.target) {
      const title = await playlist.title();
      if (title) args.target = safeFilename(title);
    }
    for await (const yt of playlist) {
      try {
        await performArgsOnYouTube(yt, args);
      } catch (err) {
        if (err instanceof exceptions.PytubeError) {
          process.stdout.write(`There was an error with video: ${yt.videoId}\n${err.message}\n`);
        } else {
          throw err;
        }
      }
    }
  } else {
    process.stdout.write('Loading video...\n');
    const yt = new YouTube(args.url);
    await performArgsOnYouTube(yt, args);
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`Error: ${err.message}\n`);
  } else {
    process.stderr.write(`Unknown error: ${String(err)}\n`);
  }
  process.exit(1);
});
