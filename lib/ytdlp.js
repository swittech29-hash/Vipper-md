import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';

// The yt-dlp program is downloaded into /bin during the Render build
const BIN = process.env.YTDLP_PATH || fileURLToPath(new URL('../bin/yt-dlp', import.meta.url));
const MAX_MB = Number(process.env.DL_MAX_MB || 50);
const MAX_SECONDS = Number(process.env.DL_MAX_SECONDS || 900);
const VIDEO_HEIGHT = Number(process.env.VIDEO_HEIGHT || 480);
const TIMEOUT_MS = 150000;
const MAX_PARALLEL = 2;

let active = 0;

// Optional cookies, for sites that block the server (see setup notes)
let cookiesFile = null;
if (process.env.YTDLP_COOKIES) {
  cookiesFile = path.join(os.tmpdir(), 'yt-cookies.txt');
  fs.writeFileSync(cookiesFile, process.env.YTDLP_COOKIES.replace(/\\n/g, '\n'), { mode: 0o600 });
}

const userError = (message) => Object.assign(new Error(message), { user: true });

function exec(args, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(userError('That took too long, so I stopped. Try a shorter video.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-6000)));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? userError('The downloader is not installed on the server yet. The owner needs to update the Render build command.')
          : err
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function explain(stderr) {
  const t = stderr.toLowerCase();
  if (t.includes('sign in to confirm') || t.includes('not a bot')) {
    return 'YouTube is blocking this server right now. Try again later, or try a different link.';
  }
  if (t.includes('private')) return 'That video is private.';
  if (t.includes('login required') || t.includes('log in') || t.includes('cookies')) {
    return 'That site needs a login to show this content, so only fully public links work.';
  }
  if (t.includes('unsupported url')) return 'That link is not supported.';
  if (t.includes('larger than max-filesize') || t.includes('file is larger')) {
    return `That file is bigger than ${MAX_MB} MB.`;
  }
  if (t.includes('does not pass filter') || t.includes('is live')) {
    return `That is a live stream or is longer than ${Math.round(MAX_SECONDS / 60)} minutes.`;
  }
  if (t.includes('unavailable') || t.includes('removed') || t.includes('not available')) {
    return 'That video is unavailable.';
  }
  return 'Could not download that. The link may be private, removed or unsupported.';
}

const AUDIO_EXT = ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'aac'];
const VIDEO_EXT = ['mp4', 'mkv', 'webm', 'mov'];

function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'image';
}

/**
 * Download `target` (a link or "ytsearch1:words") and call handler({ file, title, type }).
 * The temporary files are always deleted afterwards.
 * mode: 'audio' makes an mp3, 'video' makes an mp4 (or an image for photo posts).
 */
export async function withDownload(target, mode, handler) {
  if (active >= MAX_PARALLEL) {
    throw userError('I am busy with other downloads. Try again in a minute.');
  }
  active++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  try {
    const args = [
      '--no-warnings', '--no-progress', '--no-playlist', '--playlist-items', '1',
      '--restrict-filenames',
      '--js-runtimes', 'node',
      '--ffmpeg-location', ffmpegPath,
      '--max-filesize', `${MAX_MB}M`,
      '--match-filters', `!is_live & duration<=?${MAX_SECONDS}`,
      '-o', path.join(dir, '%(id).60s.%(ext)s'),
      '--no-simulate',
      '--print', 'after_move:TITLE=%(title)s',
      '--print', 'after_move:FILE=%(filepath)s',
    ];

    if (mode === 'audio') {
      args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '5');
    } else {
      const h = VIDEO_HEIGHT;
      args.push(
        '-f',
        `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}][ext=mp4]/bv*[height<=${h}]+ba/b[height<=${h}]/b`,
        '--merge-output-format', 'mp4'
      );
    }
    if (cookiesFile) args.push('--cookies', cookiesFile);
    args.push(target);

    const { code, stdout, stderr } = await exec(args);
    if (code !== 0) {
      console.error('[yt-dlp] failed:', stderr.slice(-600));
      throw userError(explain(stderr));
    }

    const lines = stdout.split('\n').map((l) => l.trim());
    const title = (lines.find((l) => l.startsWith('TITLE=')) || 'TITLE=Download').slice(6) || 'Download';
    let file = (lines.find((l) => l.startsWith('FILE=')) || '').slice(5);
    if (!file || !fs.existsSync(file)) {
      const found = fs.readdirSync(dir).filter((f) => !f.endsWith('.part'));
      if (!found.length) throw userError('Nothing was downloaded. The link may not contain media.');
      file = path.join(dir, found[0]);
    }

    if (fs.statSync(file).size > MAX_MB * 1024 * 1024) {
      throw userError(`That file is bigger than ${MAX_MB} MB.`);
    }

    await handler({ file, title, type: kindOf(file) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    active--;
  }
}

// Update the yt-dlp program in place (sites change often)
export async function updateEngine() {
  const { stdout, stderr } = await exec(['-U'], 90000);
  return (stdout + stderr).trim().split('\n').slice(-4).join('\n');
}
