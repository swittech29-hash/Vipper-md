import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveChannel } from '../lib/channel.js';

// Picture shown on top of the menu (menu.jpg in the main folder)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

// Time zone for the Time and Date lines, e.g. TIMEZONE=Africa/Nairobi
function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}
const TZ = validZone(process.env.TIMEZONE || 'UTC');

// Menu sections, in the order they are shown.
// A command lands in a section by its `category` field (case does not matter).
const SECTIONS = [
  ['GENERAL', '📊'],
  ['OWNER', '👑'],
  ['GROUP', '👥'],
  ['SETTINGS', '⚙️'],
  ['DOWNLOADER', '📥'],
  ['TOOLS', '🔧'],
  ['UTILITIES', '🛠️'],
  ['AI & IMAGE GEN', '🤖'],
  ['SEARCH', '🔍'],
  ['INFORMATION', '🌐'],
  ['PHOTO EFFECTS', '🎨'],
  ['LOGO & TEXT MAKERS', '🎨'],
  ['AUDIO EFFECTS', '🎵'],
  ['EMOJI ANIMATIONS', '😂'],
  ['GAMES & FUN', '🎮'],
  ['ANIME & REACTIONS', '🎌'],
  ['MOVIES / SERIES', '🎬'],
  ['FOOTBALL', '⚽'],
  ['STALK', '👁️'],
  ['GITHUB', '🐙'],
  ['CHANNEL', '📺'],
  ['FINANCE', '💰'],
  ['TEMP MAIL / NUMBER', '📧'],
  ['CPANEL', '🖥️'],
];
const EMOJI = Object.fromEntries(SECTIONS);
const ORDER = SECTIONS.map(([name]) => name);

// Shorter category names that should land in a section above
const ALIASES = {
  DOWNLOAD: 'DOWNLOADER',
  DOWNLOADS: 'DOWNLOADER',
  AI: 'AI & IMAGE GEN',
  UTILITY: 'UTILITIES',
  FUN: 'GAMES & FUN',
  GAMES: 'GAMES & FUN',
  INFO: 'INFORMATION',
  MOVIES: 'MOVIES / SERIES',
  ANIME: 'ANIME & REACTIONS',
  LOGO: 'LOGO & TEXT MAKERS',
  PHOTO: 'PHOTO EFFECTS',
  AUDIO: 'AUDIO EFFECTS',
  TEMPMAIL: 'TEMP MAIL / NUMBER',
};

// Country by phone number prefix: [name, ISO code for the flag]
const COUNTRIES = {
  '20': ['Egypt', 'EG'],
  '27': ['South Africa', 'ZA'],
  '44': ['United Kingdom', 'GB'],
  '55': ['Brazil', 'BR'],
  '62': ['Indonesia', 'ID'],
  '63': ['Philippines', 'PH'],
  '84': ['Vietnam', 'VN'],
  '91': ['India', 'IN'],
  '92': ['Pakistan', 'PK'],
  '212': ['Morocco', 'MA'],
  '233': ['Ghana', 'GH'],
  '234': ['Nigeria', 'NG'],
  '250': ['Rwanda', 'RW'],
  '251': ['Ethiopia', 'ET'],
  '254': ['Kenya', 'KE'],
  '255': ['Tanzania', 'TZ'],
  '256': ['Uganda', 'UG'],
  '260': ['Zambia', 'ZM'],
  '263': ['Zimbabwe', 'ZW'],
  '880': ['Bangladesh', 'BD'],
};

const flag = (iso) =>
  iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

function countryOf(jid) {
  // Only real phone-number ids can be matched. Hidden (@lid) ids cannot.
  if (!String(jid).endsWith('@s.whatsapp.net')) return 'Unknown 🌍';
  const number = String(jid).split('@')[0].split(':')[0];
  for (const len of [3, 2]) {
    const hit = COUNTRIES[number.slice(0, len)];
    if (hit) return `${hit[0]} ${flag(hit[1])}`;
  }
  return 'Unknown 🌍';
}

function formatUptime(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m ${s % 60}s`;
}

function clock() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString('en-US', { timeZone: TZ, hour12: true }),
    date: now.toLocaleDateString('en-US', {
      timeZone: TZ,
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    }),
  };
}

// Days left until December 25 (0 = today, null = not close or already past)
function daysToChristmas() {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const [y, m, d] = iso.split('-').map(Number);
  const days = Math.round((Date.UTC(y, 11, 25) - Date.UTC(y, m - 1, d)) / 86400000);
  return days >= 0 && days <= 60 ? days : null;
}

const SPLIT_AT = 3000; // longer menus are sent as the picture plus text messages
const CHUNK = 3500;

export default {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'GENERAL',
  description: 'Show the command menu',
  async run({ sock, msg, from, sender, commands, config }) {
    const prefix = config.prefix;
    const botName = config.botName;
    const { time, date } = clock();
    const xmas = daysToChristmas();

    // Group every loaded command by category
    const groups = new Map();
    for (const cmd of commands.values()) {
      if (cmd.hidden) continue;
      let cat = String(cmd.category || 'GENERAL').toUpperCase();
      cat = ALIASES[cat] || cat;
      if (!groups.has(cat)) groups.set(cat, []);
      const label = (cmd.menuName || cmd.name) + (cmd.nsfw ? ' 🔞' : '');
      groups.get(cat).push(label);
    }

    // Known sections first (in the order above), then any others
    const known = ORDER.filter((c) => groups.has(c));
    const extra = [...groups.keys()].filter((c) => !ORDER.includes(c)).sort();

    // Top part (this is the picture's caption)
    const head = [
      `❄️⋆｡‧˚ʚ 🎄 ${botName} 🎄 ɞ˚‧｡⋆❄️`,
      '',
      `👤 *User:* ${msg.pushName || ''}`,
      `🌍 *Country:* ${countryOf(sender)}`,
      `🕒 *Time:* ${time}`,
      `📅 *Date:* ${date}`,
      `⚡ *Uptime:* ${formatUptime(process.uptime())}`,
    ];
    if (xmas !== null) {
      head.push(
        '',
        xmas === 0
          ? '🎅 🎄 Merry Christmas! 🎁'
          : `🎅 🎄 ${xmas} day${xmas === 1 ? '' : 's'} until Christmas! 🎁`
      );
    }
    head.push('', '❆━━━━━━━━━━━━━━━━━━❆');

    // One block per section
    const blocks = [...known, ...extra].map((cat) =>
      [
        `❅───「 ${EMOJI[cat] || '🔹'} ${cat} 」───❅`,
        ...groups.get(cat).map((label) => `│ 🎁 ${prefix}${label}`),
        '❆───────────────❆',
      ].join('\n')
    );

    const footer = [`⚡ Powered by ${botName}`];
    if (xmas !== null) footer.push('', `🎄 Merry Christmas from ${botName}! ❄️✨`);

    const headText = head.join('\n');
    const full = [headText, ...blocks, footer.join('\n')].join('\n\n');

    // The "View channel" button comes from a forwarded-from-channel tag
    const channel = await resolveChannel(sock).catch(() => null);
    const contextInfo = channel
      ? {
          forwardingScore: 1,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: channel.jid,
            newsletterName: channel.name,
            serverMessageId: -1,
          },
        }
      : undefined;

    const send = (caption) =>
      image
        ? { image, caption, contextInfo }
        : { text: caption, contextInfo };

    // Short menu: one message
    if (full.length <= SPLIT_AT) {
      await sock.sendMessage(from, send(full), { quoted: msg });
      return;
    }

    // Long menu: picture with the top part, then the sections as text
    await sock.sendMessage(from, send(headText), { quoted: msg });

    let chunk = '';
    for (const part of [...blocks, footer.join('\n')]) {
      if (chunk && chunk.length + part.length + 2 > CHUNK) {
        await sock.sendMessage(from, { text: chunk });
        chunk = '';
      }
      chunk += (chunk ? '\n\n' : '') + part;
    }
    if (chunk) await sock.sendMessage(from, { text: chunk });
  },
};
