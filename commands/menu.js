import fs from 'fs';
import { fileURLToPath } from 'url';

// Picture shown on top of the menu (menu.jpg in the main folder)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

// Optional "View channel" button. Set these two in your environment (.env / Render):
//   CHANNEL_JID=120363xxxxxxxxxxxx@newsletter
//   CHANNEL_NAME=My Channel
const CHANNEL_JID = process.env.CHANNEL_JID;
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'Channel';

// Time zone for the Time and Date lines, e.g. TIMEZONE=Africa/Nairobi
const TIMEZONE = process.env.TIMEZONE || 'UTC';

const CATEGORY_EMOJI = {
  GENERAL: '📊',
  OWNER: '👑',
  TOOLS: '🛠️',
  GROUP: '👥',
  ADMIN: '🛡️',
  FUN: '🎉',
  MEDIA: '🎬',
  DOWNLOAD: '📥',
  AI: '🤖',
  SETTINGS: '⚙️',
  UTILITY: '🧰',
};

// Country by phone number prefix (add more if you need them)
const COUNTRIES = {
  '20': 'Egypt',
  '27': 'South Africa',
  '44': 'United Kingdom',
  '55': 'Brazil',
  '62': 'Indonesia',
  '63': 'Philippines',
  '84': 'Vietnam',
  '91': 'India',
  '92': 'Pakistan',
  '212': 'Morocco',
  '233': 'Ghana',
  '234': 'Nigeria',
  '250': 'Rwanda',
  '251': 'Ethiopia',
  '254': 'Kenya',
  '255': 'Tanzania',
  '256': 'Uganda',
  '260': 'Zambia',
  '263': 'Zimbabwe',
  '880': 'Bangladesh',
};

function countryOf(jid) {
  // Only real phone-number ids can be matched. Hidden (@lid) ids cannot.
  if (!String(jid).endsWith('@s.whatsapp.net')) return 'Unknown';
  const number = String(jid).split('@')[0].split(':')[0];
  for (const len of [3, 2]) {
    const name = COUNTRIES[number.slice(0, len)];
    if (name) return name;
  }
  return 'Unknown';
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
  try {
    return {
      time: now.toLocaleTimeString('en-US', { timeZone: TIMEZONE, hour12: true }),
      date: now.toLocaleDateString('en-US', {
        timeZone: TIMEZONE,
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      }),
    };
  } catch {
    // Bad TIMEZONE value: fall back to server time
    return { time: now.toLocaleTimeString('en-US'), date: now.toLocaleDateString('en-US') };
  }
}

const rank = (cat) => (cat === 'GENERAL' ? 0 : cat === 'OWNER' ? 99 : 1);

export default {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'GENERAL',
  description: 'Show the command menu',
  async run({ sock, msg, from, sender, commands, config }) {
    const prefix = config.prefix;
    const { time, date } = clock();

    // Group command names by category
    const groups = new Map();
    for (const cmd of commands.values()) {
      const cat = String(cmd.category || 'GENERAL').toUpperCase();
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(cmd.name);
    }
    const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    const lines = [];

    // Info box
    lines.push(`╭───( *${config.botName}* )───●`);
    lines.push(`👤 *User:* ${msg.pushName || ''}`);
    lines.push(`🌍 *Country:* ${countryOf(sender)} 🌍`);
    lines.push(`🕒 *Time:* ${time}`);
    lines.push(`📅 *Date:* ${date}`);
    lines.push(`⚡ *Uptime:* ${formatUptime(process.uptime())}`);
    lines.push('╰──────────────●');

    // One box per category
    for (const cat of order) {
      lines.push('');
      lines.push(`╭───( ${CATEGORY_EMOJI[cat] || '🔹'} *${cat}* )───●`);
      for (const name of groups.get(cat).sort()) {
        lines.push(`│ ・${prefix}${name}`);
      }
      lines.push('╰──────────────●');
    }

    const caption = lines.join('\n');

    // The "View channel" button comes from a forwarded-from-channel tag
    const contextInfo = CHANNEL_JID
      ? {
          forwardingScore: 1,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: CHANNEL_JID,
            newsletterName: CHANNEL_NAME,
            serverMessageId: -1,
          },
        }
      : undefined;

    const content = image
      ? { image, caption, contextInfo }
      : { text: caption, contextInfo };

    await sock.sendMessage(from, content, { quoted: msg });
  },
};
