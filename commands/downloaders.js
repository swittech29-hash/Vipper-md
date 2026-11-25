import { withDownload, updateEngine } from '../lib/ytdlp.js';

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

async function handle(ctx, target, mode, icon) {
  await ctx.reply(`⏳ ${icon} Downloading... this can take a minute.`);
  try {
    await withDownload(target, mode, (item) => deliver(ctx, item));
  } catch (err) {
    if (!err.user) console.error('Download error:', err);
    await ctx.reply(`❌ ${err.user ? err.message : 'Something went wrong while downloading.'}`);
  }
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
    aliases: ['song', 'music'],
    category: 'DOWNLOADER',
    description: 'Find a song by name and send it as audio',
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      const query = ctx.args.join(' ').trim();
      if (!url && !query) return ctx.reply('Type a song name. Example: !play burna boy last last');
      await handle(ctx, url || `ytsearch1:${query}`, 'audio', '🎵');
    },
  },
  {
    name: 'ytmp3',
    aliases: ['mp3'],
    category: 'DOWNLOADER',
    description: 'YouTube link or search to MP3',
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      const query = ctx.args.join(' ').trim();
      if (!url && !query) return ctx.reply('Send a link. Example: !ytmp3 https://youtu.be/xxxx');
      await handle(ctx, url || `ytsearch1:${query}`, 'audio', '🎵');
    },
  },
  {
    name: 'ytmp4',
    aliases: ['video', 'ytv'],
    category: 'DOWNLOADER',
    description: 'YouTube link or search to video',
    async run(ctx) {
      const url = findUrl(ctx.args, ctx.msg);
      const query = ctx.args.join(' ').trim();
      if (!url && !query) return ctx.reply('Send a link. Example: !ytmp4 https://youtu.be/xxxx');
      await handle(ctx, url || `ytsearch1:${query}`, 'video', '🎬');
    },
  },
  siteCommand({
    name: 'tiktok',
    aliases: ['tt'],
    pattern: /tiktok\.com/i,
    icon: '🎬',
    description: 'Download a TikTok video',
    example: '!tiktok https://www.tiktok.com/@user/video/123',
  }),
  siteCommand({
    name: 'tiktokmp3',
    aliases: ['ttmp3'],
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
    aliases: ['pin'],
    pattern: /(pinterest\.|pin\.it)/i,
    icon: '📌',
    description: 'Download a Pinterest video or image',
    example: '!pinterest https://pin.it/xxxx',
  }),
  siteCommand({
    name: 'xdown',
    aliases: ['twitter', 'x'],
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
