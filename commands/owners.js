import { getSettings, updateSettings } from '../lib/settings.js';

// 1 to 3 symbols. No letters, numbers, spaces or @ (so normal chat never triggers commands)
const PREFIX_RE = /^[^\s\w@]{1,3}$/u;

export default [
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
  {
    name: 'settings',
    aliases: ['botsettings'],
    category: 'OWNER',
    owner: true,
    description: 'Show the current bot settings',
    async run({ reply, config }) {
      const s = getSettings();
      await reply(
        `⚙️ *Bot settings*\n` +
          `Mode: *${s.mode}*\n` +
          `Prefix: *${config.prefix}*\n` +
          `Sleeping: *${s.sleeping ? 'yes' : 'no'}*`
      );
    },
  },
];
