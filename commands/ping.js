export default {
  name: 'ping',
  description: 'Check if the bot is alive',
  async run({ sock, msg, from }) {
    const start = Date.now();
    await sock.sendMessage(from, { text: 'Pinging...' }, { quoted: msg });
    const ms = Date.now() - start;
    await sock.sendMessage(from, { text: `🏓 Pong! ${ms}ms` }, { quoted: msg });
  },
};
