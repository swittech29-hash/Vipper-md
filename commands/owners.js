import { getSettings, updateSettings } from '../lib/settings.js';

// 1 to 3 symbols. No letters, numbers, spaces or @ (so normal chat never triggers commands)
const PREFIX_RE = /^[^\s\w@]{1,3}$/u;

// ---------- on/off switches ----------
function toggle(key, label, { aliases = [], onChange } = {}) {
  return {
    name: key,
    aliases,
    category: 'SETTINGS',
    owner: true,
    description: `${label} (on/off)`,
    async run(ctx) {
      const v = (ctx.args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) {
        const now = getSettings()[key] ? 'on' : 'off';
        return ctx.reply(`${label}: *${now}*\nUse ${ctx.config.prefix}${key} on or ${ctx.config.prefix}${key} off`);
      }
      await updateSettings({ [key]: v === 'on' });
      if (onChange) await onChange(ctx, v === 'on');
      await ctx.reply(`${v === 'on' ? '✅' : '❌'} ${label} is now *${v}*`);
    },
  };
}

// ---------- WhatsApp privacy settings ----------
const WHO = {
  all: 'all', everyone: 'all',
  contacts: 'contacts',
  nobody: 'none', none: 'none',
  except: 'contact_blacklist', 'contacts-except': 'contact_blacklist',
};
const WHO_TEXT = { all: 'everyone', contacts: 'my contacts', contact_blacklist: 'my contacts except...', none: 'nobody' };

function privacy({ name, label, field, method, values = WHO, text = WHO_TEXT, usage }) {
  return {
    name,
    category: 'SETTINGS',
    owner: true,
    description: `${label} privacy`,
    async run({ sock, args, reply, config }) {
      const v = (args[0] || '').toLowerCase();
      if (!v) {
        let now = 'unknown';
        try {
          const settings = await sock.fetchPrivacySettings(true);
          now = text[settings[field]] || settings[field] || 'unknown';
        } catch {}
        return reply(`${label}: *${now}*\nChange it: ${config.prefix}${name} ${usage}`);
      }
      const value = values[v];
      if (!value) return reply(`Use: ${config.prefix}${name} ${usage}`);
      await sock[method](value);
      await reply(`✅ ${label} is now *${text[value] || value}*`);
    },
  };
}

export default [
  // ----- owner -----
  {
    name: 'modeprivate',
    aliases: ['modeprive', 'private'],
    category: 'OWNER',
    owner: true,
    description: 'Only you can use the bot',
    async run({ reply }) {
      await updateSettings({ mode: 'private' });
      await reply('🔒 Private mode is ON. Only you can use the bot now.');
    },
  },
  {
    name: 'modepublic',
    aliases: ['modepablick', 'modepublick', 'public'],
    category: 'OWNER',
    owner: true,
    description: 'Everyone can use the bot',
    async run({ reply }) {
      await updateSettings({ mode: 'public' });
      await reply('🌍 Public mode is ON. Everyone can use the bot now.');
    },
  },
  {
    name: 'prefix',
    category: 'OWNER',
    owner: true,
    description: 'Show or change the command prefix',
    async run({ args, reply, config }) {
      const value = args[0];
      if (!value) {
        return reply(`Current prefix: *${config.prefix}*\nChange it with: ${config.prefix}prefix .\nReset it with: ${config.prefix}prefix reset`);
      }
      const next = value.toLowerCase() === 'reset' ? '!' : value;
      if (!PREFIX_RE.test(next)) {
        return reply('❌ Use 1 to 3 symbols, like ! . # $ / ~ (no letters, numbers or spaces).');
      }
      await updateSettings({ prefix: next });
      await reply(`✅ Prefix changed to *${next}*\nUse ${next}menu from now on.\nIf you forget it, send !prefix reset`);
    },
  },
  {
    name: 'sleepbot',
    category: 'OWNER',
    owner: true,
    description: 'Put the bot to sleep (on) or wake it (off)',
    async run({ args, reply, config }) {
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) {
        return reply(`Use ${config.prefix}sleepbot on or ${config.prefix}sleepbot off`);
      }
      await updateSettings({ sleeping: v === 'on' });
      await reply(
        v === 'on'
          ? `😴 Bot is asleep. I will ignore every command until you send ${config.prefix}sleepbot off.`
          : '☀️ Bot is awake and ready.'
      );
    },
  },

  // ----- settings -----
  {
    name: 'mode',
    category: 'SETTINGS',
    owner: true,
    description: 'Show or set the mode (public or private)',
    async run({ args, reply, config }) {
      const v = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(v)) {
        return reply(`Mode: *${getSettings().mode}*\nUse ${config.prefix}mode public or ${config.prefix}mode private`);
      }
      await updateSettings({ mode: v });
      await reply(v === 'private' ? '🔒 Private mode is ON. Only you can use the bot now.' : '🌍 Public mode is ON. Everyone can use the bot now.');
    },
  },
  toggle('autoread', 'Auto read messages'),
  toggle('autotyping', 'Auto typing'),
  toggle('autorecording', 'Auto recording'),
  toggle('autoreact', 'Auto react (private chats)'),
  toggle('autostatus', 'Auto view statuses'),
  toggle('autosavestatus', 'Auto save statuses to your chat'),
  toggle('ghost', 'Ghost mode (appear offline)', {
    async onChange({ sock }, on) {
      await sock.sendPresenceUpdate(on ? 'unavailable' : 'available').catch(() => {});
    },
  }),
  toggle('antidelete', 'Anti delete (deleted messages sent to your chat)'),
  toggle('antiedit', 'Anti edit (edited messages sent to your chat)'),
  privacy({
    name: 'lastseen',
    label: 'Last seen',
    field: 'last',
    method: 'updateLastSeenPrivacy',
    usage: 'all | contacts | except | nobody',
  }),
  privacy({
    name: 'ppprivacy',
    label: 'Profile photo',
    field: 'profile',
    method: 'updateProfilePicturePrivacy',
    usage: 'all | contacts | except | nobody',
  }),
  privacy({
    name: 'readreceipts',
    label: 'Read receipts',
    field: 'readreceipts',
    method: 'updateReadReceiptsPrivacy',
    values: { on: 'all', all: 'all', off: 'none', none: 'none' },
    text: { all: 'on', none: 'off' },
    usage: 'on | off',
  }),
  {
    name: 'settings',
    aliases: ['botsettings'],
    category: 'SETTINGS',
    owner: true,
    description: 'Show all bot settings',
    async run({ reply, config }) {
      const s = getSettings();
      const on = (k) => (s[k] ? '✅' : '❌');
      await reply(
        `⚙️ *Bot settings*\n` +
          `Mode: *${s.mode}*\n` +
          `Prefix: *${config.prefix}*\n` +
          `Sleeping: ${on('sleeping')}\n\n` +
          `${on('autoread')} autoread\n` +
          `${on('autotyping')} autotyping\n` +
          `${on('autorecording')} autorecording\n` +
          `${on('autoreact')} autoreact\n` +
          `${on('autostatus')} autostatus\n` +
          `${on('autosavestatus')} autosavestatus\n` +
          `${on('ghost')} ghost\n` +
          `${on('antidelete')} antidelete\n` +
          `${on('antiedit')} antiedit`
      );
    },
  },
];
