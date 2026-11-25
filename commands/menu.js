export default {
  name: 'menu',
  description: 'Show all commands',
  async run({ sock, msg, from, commands, config }) {
    const list = [...commands.values()]
      .map((c) => `│ ${config.prefix}${c.name} - ${c.description}`)
      .join('\n');

    const text =
      `╭─ *${config.botName}* ─╮\n` +
      `${list}\n` +
      `╰──────────────╯`;

    await sock.sendMessage(from, { text }, { quoted: msg });
  },
};
