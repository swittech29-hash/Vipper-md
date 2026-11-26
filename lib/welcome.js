import fs from 'fs';
import { fileURLToPath } from 'url';
import * as baileysNs from '@whiskeysockets/baileys';
import { getSettings, updateSettings } from './settings.js';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const b =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const { jidNormalizedUser } = b;

const OWNER = 'SwiftTech';
const AWAY_MS = 15 * 60 * 1000; // "back online" message only after being away this long
const SAVE_EVERY_MS = 2 * 60 * 1000; // how often we note that the bot is still online

// The same picture the menu uses (menu.jpg in the main folder)
const imagePath = fileURLToPath(new URL('../menu.jpg', import.meta.url));
const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let timer = null;

function welcomeText(config) {
  return (
    `✅ *Connected successfully!*\n\n` +
    `Welcome to *${config.botName}* 👑\n` +
    `Powered by *${OWNER}*\n\n` +
    `Prefix: *${config.prefix}*  |  Mode: *${getSettings().mode}*\n` +
    `Type *${config.prefix}menu* to see all commands.`
  );
}

/**
 * Call when the bot connects.
 * - First connection after pairing: welcome message to your own chat.
 * - Later: stays quiet, unless the bot was offline for a while ("back online").
 */
export async function onConnected(sock, config, { delayMs = 3000 } = {}) {
  const s = getSettings();
  const away = s.lastOnlineAt ? Date.now() - s.lastOnlineAt : 0;
  const me = jidNormalizedUser(sock.user.id);

  try {
    if (!s.welcomed) {
      await sleep(delayMs); // give the connection a moment to settle
      const text = welcomeText(config);
      try {
        if (image) await sock.sendMessage(me, { image, caption: text });
        else await sock.sendMessage(me, { text });
      } catch {
        await sock.sendMessage(me, { text }); // picture failed, send plain text
      }
      await updateSettings({ welcomed: true });
      console.log('[welcome] welcome message sent');
    } else if (away > AWAY_MS) {
      await sleep(delayMs);
      await sock.sendMessage(me, { text: `✅ *${config.botName}* is back online.` });
      console.log('[welcome] back-online message sent');
    }
  } catch (err) {
    // welcomed stays false if sending failed, so it is tried again on the next connect
    console.error('[welcome] could not send:', err?.message || err);
  }

  await updateSettings({ lastOnlineAt: Date.now() });
  clearInterval(timer);
  timer = setInterval(() => updateSettings({ lastOnlineAt: Date.now() }), SAVE_EVERY_MS);
}

export function onDisconnected() {
  clearInterval(timer);
  timer = null;
}

// Call after the session is wiped (logged out), so the next pairing gets a welcome again
export async function resetWelcome() {
  await updateSettings({ welcomed: false, lastOnlineAt: null });
}
