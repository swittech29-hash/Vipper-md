import { withDownload, updateEngine } from '../lib/ytdlp.js';
import { giftedAvailable, withGiftedFile } from '../lib/gifted.js';

const URL_RE = /https?:\/\/[^\s]+/i;

function quotedText(msg) {
  const m = msg.message?.ephemeralMessage?.message || msg.message;
  const q = m?.extendedTextMessage?.contextInfo?.quotedMessage;
  return q?.conversation || q?.extendedTextMessage?.text || '';
}

// A link typed after the command, or in the message being replied to
function findUrl(args, msg) {
  return args.join(' ').match(URL_RE)?.[0] || quotedText(msg).match(URL_RE)?.[0] || null;
}

const safeName = (s) => String(s).replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'download';

async function deliver({ sock, from, msg }, item) {
  const quoted = { quoted: msg };
  if (item.type === 'audio') {
    await sock.sendMessage(
      from,
      { audio: { url: item.file }, mimetype: 'audio/mpeg', fileName: `${safeName(item.title)}.mp3` },
      quoted
    );
    await sock.sendMessage(from, { text: `🎵 ${item.title}` }, quoted);
  } else if (item.type === 'video') {
    await sock.sendMessage(
      from,
      { video: { url: item.file }, caption: `🎬 ${item.title}`, mimetype: 'video/mp4' },
      quoted
    );
  } else {
    await sock.sendMessage(from, { image: { url: item.file }, caption: `🖼️ ${item.title}` }, quoted);
  }
}

// Title of a YouTube link, without downloading it (used to find it on SoundCloud)
async function youtubeTitle(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return [data.title, data.author_name].filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}

const isYouTube = (u) => /(youtube\.com|youtu\.be)/i.test(u || '');
const NOT_FOUND =
  'I could not find that song on SoundCloud. Try the artist and the title, for example: !play burna boy last last';

// Optional backup service for YouTube (only runs when GIFTED_FALLBACK=1)
async function tryBackup(ctx, input, mode) {
  if (!(await giftedAvailable())) return false;
  await ctx.reply('⚠️ YouTube blocked me, trying a backup service...');
  try {
    await withGiftedFile(input, mode, (item) => deliver(ctx, item));
    return true;
  } catch (err) {
    console.error('[gifted] failed:', err.message);
    return false;
  }
}

/**
 * fallback (audio only): a search text, or a function returning one.
 * If YouTube blocks the server, the bot looks the song up on SoundCloud instead.
 * opts.search: the target is a SoundCloud search, so give a "not found" message.
 */
async function handle(ctx, target, mode, icon, fallback, opts = {}) {
  await ctx.reply(`⏳ ${icon} ${opts.search ? 'Searching SoundCloud...' : 'Downloading... this can take a minute.'}`);
  try {
    await withDownload(target, mode, (item) => deliver(ctx, item));
  } catch (err) {
    if (err.blocked && opts.youtube && (await tryBackup(ctx, opts.youtube, mode))) return;
    if (err.blocked && fallback && mode === 'audio') {
      const query = typeof fallback === 'function' ? await fallback() : fallback;
      if (query) {
        await ctx.reply('⚠️ YouTube blocked me, so I am searching SoundCloud instead...');
        try {
          await withDownload(`scsearch1:${query}`, 'audio', (item) => deliver(ctx, item));
          return;
        } catch (err2) {
          if (!err2.user) console.error('SoundCloud fallback error:', err2);
          return ctx.reply(`❌ ${err2.generic ? NOT_FOUND : err2.user ? err2.message : 'Something went wrong.'}`);
        }
      }
    }
    if (!err.user) console.error('Download error:', err);
    const extra =
      err.blocked && mode === 'video'
        ? '\nVideo from YouTube is blocked on this server. Songs via !play still work.'
        : '';
    const text = err.user ? (err.generic && opts.search ? NOT_FOUND : err.message) : 'Something went wrong while downloading.';
    await ctx.reply(`❌ ${text}${extra}`);
  }
}

// A song name goes to SoundCloud. A link goes straight to that site.
async function audioCommand(ctx, example) {
  const url = findUrl(ctx.args, ctx.msg);
  const query = ctx.args.join(' ').trim();
  if (!url && !query) return ctx.reply(`Type a song name or send a link. Example: ${example}`);
  if (url) {
    return handle(ctx, url, 'audio', '🎵', isYouTube(url) ? () => youtubeTitle(url) : null, {
      youtube: isYouTube(url) ? url : null,
    });
  }
  return handle(ctx, `scsearch1:${query}`, 'audio', '🎵', null, { search: true });
}

// Commands that need a link from one particular site
function siteCommand({ name, aliases = [], pattern, mode = 'video', icon, description, example }) {
  return {
    name,
    aliases,
    category: 'DOWNLOADER',
    description,
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      if (!url || !pattern.test(url)) {
        return ctx.reply(`Send a link. Example: ${example}`);
      }
      await handle(ctx, url, mode, icon);
    },
  };
}

export default [
  {
    name: 'play',
    aliases: ['song', 'music', 'p'],
    category: 'DOWNLOADER',
    description: 'Find a song by name (SoundCloud) and send it as audio',
    async run(ctx) {
      await audioCommand(ctx, '!play burna boy last last');
    },
  },
  {
    name: 'soundcloud',
    aliases: ['scloud', 'sc'],
    category: 'DOWNLOADER',
    description: 'Song by name or SoundCloud link, as audio',
    async run(ctx) {
      await audioCommand(ctx, '!soundcloud https://soundcloud.com/artist/track');
    },
  },
  {
    name: 'ytmp3',
    aliases: ['mp3', 'yta'],
    category: 'DOWNLOADER',
    description: 'Link or song name to MP3',
    async run(ctx) {
      await audioCommand(ctx, '!ytmp3 https://youtu.be/xxxx');
    },
  },
  {
    name: 'ytmp4',
    aliases: ['video', 'ytv', 'yt'],
    category: 'DOWNLOADER',
    description: 'YouTube link or search to video',
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      const query = ctx.args.join(' ').trim();
      if (!url && !query) return ctx.reply('Send a link. Example: !ytmp4 https://youtu.be/xxxx');
      await handle(ctx, url || `ytsearch1:${query}`, 'video', '🎬', null, { youtube: url || query });
    },
  },
  siteCommand({
    name: 'tiktok',
    aliases: ['tt', 'tk'],
    pattern: /tiktok\.com/i,
    icon: '🎬',
    description: 'Download a TikTok video',
    example: '!tiktok https://www.tiktok.com/@user/video/123',
  }),
  siteCommand({
    name: 'tiktokmp3',
    aliases: ['ttmp3', 'tkmp3'],
    pattern: /tiktok\.com/i,
    mode: 'audio',
    icon: '🎵',
    description: 'Get the sound from a TikTok',
    example: '!tiktokmp3 https://www.tiktok.com/@user/video/123',
  }),
  siteCommand({
    name: 'instagram',
    aliases: ['ig', 'insta'],
    pattern: /instagram\.com/i,
    icon: '📸',
    description: 'Download an Instagram reel or post',
    example: '!instagram https://www.instagram.com/reel/xxxx',
  }),
  siteCommand({
    name: 'facebook',
    aliases: ['fb'],
    pattern: /(facebook\.com|fb\.watch|fb\.com)/i,
    icon: '📘',
    description: 'Download a Facebook video',
    example: '!facebook https://www.facebook.com/watch?v=123',
  }),
  siteCommand({
    name: 'pinterest',
    aliases: ['pin', 'pt'],
    pattern: /(pinterest\.|pin\.it)/i,
    icon: '📌',
    description: 'Download a Pinterest video or image',
    example: '!pinterest https://pin.it/xxxx',
  }),
  siteCommand({
    name: 'xdown',
    aliases: ['twitter', 'x', 'tw'],
    pattern: /(twitter\.com|x\.com)/i,
    icon: '🐦',
    description: 'Download a video from X (Twitter)',
    example: '!xdown https://x.com/user/status/123',
  }),
  {
    name: 'download',
    aliases: ['dl'],
    category: 'DOWNLOADER',
    description: 'Download media from any supported link',
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      if (!url) return ctx.reply('Send a link. Example: !download https://...');
      await handle(ctx, url, 'video', '📥');
    },
  },
  {
    name: 'ytupdate',
    category: 'DOWNLOADER',
    owner: true,
    description: 'Update the downloader engine (owner only)',
    async run(ctx) {
      await ctx.reply('🔄 Checking for a downloader update...');
      try {
        await ctx.reply(await updateEngine());
      } catch (err) {
        await ctx.reply(`❌ ${err.user ? err.message : 'Update failed.'}`);
      }
    },
  },
];
