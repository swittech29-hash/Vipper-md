import fs from 'fs';
import { fileURLToPath } from 'url';

// menu.jpg sits in the main folder of the repo (next to index.js)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

const OWNER = 'SwiftTech';
const VERSION = 'v1.0.0';
const TIMEZONE = process.env.TIMEZONE || 'UTC'; // e.g. Africa/Lagos

// Commands without a category set here or in their own file go to BOT
const CATEGORY_OVERRIDES = { setpp: 'OWNER' };

const CATEGORIES = [
  ['OWNER', '👑'],
  ['SETTINGS', '⚙️'],
  ['BOT', '💻'],
  ['GROUP', '👥'],
  ['AI', '🤖'],
  ['DOWNLOADER', '📥'],
  ['AUDIO', '🎚️'],
  ['CONVERTER', '🎨'],
  ['LOGO MAKER', '🔤'],
  ['TOOLS', '🛠️'],
  ['STALK', '🕵️'],
  ['GAMES', '🎮'],
  ['FUN', '🎯'],
  ['PIES', '🖼️'],
  ['ANIME', '🌸'],
  ['PREMIUM', '👑'],
];

function formatUptime(total) {
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s}s`;
}

export default {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'BOT',
  description: 'Show all commands',
  async run({ sock, msg, from, commands, config }) {
    const prefix = config.prefix;

    // Group commands by category
    const groups = {};
    for (const cmd of commands.values()) {
      const cat = (CATEGORY_OVERRIDES[cmd.name] || cmd.category || 'BOT').toUpperCase();
      (groups[cat] ||= []).push(cmd.name);
    }

    const ordered = CATEGORIES.filter(([c]) => groups[c]);
    for (const c of Object.keys(groups)) {
      if (!CATEGORIES.some(([k]) => k === c)) ordered.push([c, '📌']);
    }

    const sections = ordered.map(([cat, emoji]) => {
      const lines = groups[cat].sort().map((n) => `║ ➣ *${prefix}${n}*`);
      return `╔═══════════════╗\n  ${emoji} *${cat}*\n╠───────────────╣\n${lines.join('\n')}\n╚═══════════════╝`;
    });

    const ts = Number(msg.messageTimestamp || 0) * 1000;
    const ping = ts ? Math.max(0, Date.now() - ts) : 0;
    const time = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
    const name = msg.pushName || 'there';

    const header =
      `*Hey ${name}* 👋\n` +
      `╔════════◇◆◇═══════╗\n` +
      `├ *${config.botName}*\n` +
      `├▢👑 Owner: *${OWNER}*\n` +
      `├▢🕐 *${time}*\n` +
      `├▢⏱️ Uptime: *${formatUptime(process.uptime())}*\n` +
      `├▢📶 Ping: *${ping}ms*\n` +
      `├▢🔖 Version: *${VERSION}*\n` +
      `├▢📚 Commands: *${commands.size}*\n` +
      `╚════════◇◆◇═══════╝`;

    const footer =
      `╔══════════════════╗\n` +
      `        *ABOUT US*\n` +
      `╠──────────────────╣\n` +
      ` *MultiDevice WhatsApp Bot*\n` +
      `  Powered by *${OWNER}*\n` +
      ` Thanks for using ${config.botName} 🙏\n` +
      `╚══════════════════╝`;

    // Picture + header first, then the full list (image captions have a length limit)
    if (image) {
      await sock.sendMessage(from, { image, caption: header }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: header }, { quoted: msg });
    }
    await sock.sendMessage(from, { text: `${sections.join('\n\n')}\n\n${footer}` });
  },
};
