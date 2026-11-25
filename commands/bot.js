const OWNER = 'SwiftTech';
const REPO = 'https://github.com/swittech29-hash/Vipper-md';

function formatUptime(total) {
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return `${d ? d + 'd ' : ''}${h}h ${m}m ${s}s`;
}

export default [
  {
    name: 'alive',
    category: 'BOT',
    description: 'Check the bot is online',
    async run({ reply, config }) {
      await reply(`✅ *${config.botName}* is online and running.\n⏱️ Uptime: ${formatUptime(process.uptime())}`);
    },
  },
  {
    name: 'runtime',
    aliases: ['uptime'],
    category: 'BOT',
    description: 'How long the bot has been running',
    async run({ reply }) {
      await reply(`⏱️ Uptime: *${formatUptime(process.uptime())}*`);
    },
  },
  {
    name: 'owner',
    category: 'BOT',
    description: 'Show the bot owner',
    async run({ reply, config }) {
      await reply(`👑 *${config.botName}* is powered by *${OWNER}*.`);
    },
  },
  {
    name: 'repo',
    aliases: ['source'],
    category: 'BOT',
    description: 'Bot source code link',
    async run({ reply }) {
      await reply(`💻 Source: ${REPO}`);
    },
  },
];
