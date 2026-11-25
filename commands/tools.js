import crypto from 'crypto';

// Text from the command, or from the message being replied to
function inputText(msg, args) {
  if (args.length) return args.join(' ');
  const m = msg.message?.ephemeralMessage?.message || msg.message;
  const q = m?.extendedTextMessage?.contextInfo?.quotedMessage;
  return q?.conversation || q?.extendedTextMessage?.text || '';
}

const FLIP = {
  a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ',
  n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
  '?': '¿', '!': '¡', '.': '˙', ',': "'",
};

const NORMAL = Array.from('abcdefghijklmnopqrstuvwxyz');
const SMALL = Array.from('ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ');

export default [
  {
    name: 'calculator',
    aliases: ['calc'],
    category: 'TOOLS',
    description: 'Do maths. Example: !calc 12*(3+4)',
    async run({ args, reply }) {
      const expr = args.join(' ').replace(/\^/g, '**').replace(/×/g, '*').replace(/÷/g, '/');
      if (!expr) return reply('Type a sum. Example: !calc 12*(3+4)');
      if (!/^[0-9+\-*/().%\s]+$/.test(expr)) {
        return reply('❌ Only numbers and + - * / % ^ ( ) are allowed.');
      }
      let result;
      try {
        result = Function(`"use strict"; return (${expr})`)();
      } catch {
        return reply('❌ That is not a valid sum.');
      }
      if (typeof result !== 'number' || !Number.isFinite(result)) return reply('❌ Cannot calculate that.');
      await reply(`🧮 ${args.join(' ')} = *${result}*`);
    },
  },
  {
    name: 'base64',
    category: 'TOOLS',
    description: 'Encode or decode. Example: !base64 encode hello',
    async run({ args, reply }) {
      const mode = (args[0] || '').toLowerCase();
      const data = args.slice(1).join(' ');
      if (!['encode', 'decode'].includes(mode) || !data) {
        return reply('Use: !base64 encode <text> or !base64 decode <text>');
      }
      try {
        await reply(mode === 'encode'
          ? Buffer.from(data).toString('base64')
          : Buffer.from(data, 'base64').toString('utf8'));
      } catch {
        await reply('❌ Could not convert that.');
      }
    },
  },
  {
    name: 'binary',
    category: 'TOOLS',
    description: 'Text to binary',
    async run({ msg, args, reply }) {
      const t = inputText(msg, args);
      if (!t) return reply('Type some text. Example: !binary hi');
      await reply([...Buffer.from(t)].map((b) => b.toString(2).padStart(8, '0')).join(' '));
    },
  },
  {
    name: 'binarytotext',
    category: 'TOOLS',
    description: 'Binary to text',
    async run({ args, reply }) {
      const bits = args.join(' ').trim().split(/\s+/).filter(Boolean);
      if (!bits.length || bits.some((b) => !/^[01]{8}$/.test(b))) {
        return reply('Send 8-digit binary groups. Example: !binarytotext 01101000 01101001');
      }
      await reply(Buffer.from(bits.map((b) => parseInt(b, 2))).toString('utf8'));
    },
  },
  {
    name: 'hash',
    category: 'TOOLS',
    description: 'Hash text. Example: !hash sha256 hello',
    async run({ args, reply }) {
      const algo = (args[0] || '').toLowerCase();
      const data = args.slice(1).join(' ');
      if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algo) || !data) {
        return reply('Use: !hash <md5|sha1|sha256|sha512> <text>');
      }
      await reply(crypto.createHash(algo).update(data).digest('hex'));
    },
  },
  {
    name: 'timestamp',
    category: 'TOOLS',
    description: 'Current time as a Unix timestamp',
    async run({ args, reply }) {
      if (args[0] && /^\d+$/.test(args[0])) {
        return reply(`🕐 ${new Date(Number(args[0]) * 1000).toUTCString()}`);
      }
      await reply(`🕐 ${Math.floor(Date.now() / 1000)}`);
    },
  },
  {
    name: 'count',
    category: 'TOOLS',
    description: 'Count characters and words',
    async run({ msg, args, reply }) {
      const t = inputText(msg, args);
      if (!t) return reply('Type some text or reply to a message.');
      const words = t.trim().split(/\s+/).filter(Boolean).length;
      await reply(`🔢 Characters: *${t.length}*\n📝 Words: *${words}*\n📄 Lines: *${t.split('\n').length}*`);
    },
  },
  {
    name: 'reverse',
    category: 'TOOLS',
    description: 'Reverse text',
    async run({ msg, args, reply }) {
      const t = inputText(msg, args);
      if (!t) return reply('Type some text. Example: !reverse hello');
      await reply(Array.from(t).reverse().join(''));
    },
  },
  {
    name: 'case',
    category: 'TOOLS',
    description: 'Change case. Example: !case upper hello',
    async run({ args, reply }) {
      const mode = (args[0] || '').toLowerCase();
      const t = args.slice(1).join(' ');
      if (!t || !['upper', 'lower', 'title'].includes(mode)) {
        return reply('Use: !case <upper|lower|title> <text>');
      }
      const out =
        mode === 'upper' ? t.toUpperCase()
        : mode === 'lower' ? t.toLowerCase()
        : t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      await reply(out);
    },
  },
  {
    name: 'palindrome',
    category: 'TOOLS',
    description: 'Check if text is a palindrome',
    async run({ args, reply }) {
      const t = args.join(' ');
      if (!t) return reply('Type a word. Example: !palindrome level');
      const clean = t.toLowerCase().replace(/[^a-z0-9]/g, '');
      const ok = clean.length > 0 && clean === Array.from(clean).reverse().join('');
      await reply(ok ? `✅ "${t}" is a palindrome.` : `❌ "${t}" is not a palindrome.`);
    },
  },
  {
    name: 'age',
    category: 'TOOLS',
    description: 'Work out age. Example: !age 2000-05-17',
    async run({ args, reply }) {
      const birth = new Date(args[0] || '');
      if (!args[0] || Number.isNaN(birth.getTime()) || birth > new Date()) {
        return reply('Use a past date as YYYY-MM-DD. Example: !age 2000-05-17');
      }
      const now = new Date();
      let years = now.getFullYear() - birth.getFullYear();
      let months = now.getMonth() - birth.getMonth();
      let days = now.getDate() - birth.getDate();
      if (days < 0) {
        months -= 1;
        days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      }
      if (months < 0) {
        years -= 1;
        months += 12;
      }
      await reply(`🎂 You are *${years}* years, *${months}* months and *${days}* days old.`);
    },
  },
  {
    name: 'fliptext',
    category: 'TOOLS',
    description: 'Flip text upside down',
    async run({ msg, args, reply }) {
      const t = inputText(msg, args);
      if (!t) return reply('Type some text. Example: !fliptext hello');
      await reply(Array.from(t.toLowerCase()).map((c) => FLIP[c] || c).reverse().join(''));
    },
  },
  {
    name: 'smallcaps',
    category: 'TOOLS',
    description: 'ꜱᴍᴀʟʟ ᴄᴀᴘꜱ text',
    async run({ msg, args, reply }) {
      const t = inputText(msg, args);
      if (!t) return reply('Type some text. Example: !smallcaps hello');
      await reply(Array.from(t.toLowerCase()).map((c) => {
        const i = NORMAL.indexOf(c);
        return i === -1 ? c : SMALL[i];
      }).join(''));
    },
  },
  {
    name: 'weather',
    category: 'TOOLS',
    description: 'Weather for a city. Example: !weather Lagos',
    async run({ args, reply }) {
      const city = args.join(' ').trim();
      if (!city) return reply('Type a city. Example: !weather Lagos');
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error('bad response');
        await reply(`🌤️ ${(await res.text()).trim()}`);
      } catch {
        await reply('❌ Could not get the weather right now. Try again later.');
      }
    },
  },
];
