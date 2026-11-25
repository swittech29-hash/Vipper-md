import fs from 'fs';
import { fileURLToPath } from 'url';

// menu.jpg sits in the main folder of the repo (next to index.js)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

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
      `╰──────────────╯\n` +
      `_Powered by SwiftTech_`;

    if (image) {
      await sock.sendMessage(from, { image, caption: text }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text }, { quoted: msg });
    }
  },
};
