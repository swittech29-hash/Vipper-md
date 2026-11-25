import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'url';
import * as baileysNs from '@whiskeysockets/baileys';

import config from './config.js';
import { supabase, saveUser } from './lib/db.js';
import { useSupabaseAuthState } from './lib/supabaseAuth.js';

// Works with both Baileys 6.x (CommonJS) and 7.x (ESM)
const baileys =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;
const makeWASocket =
  typeof baileys.default === 'function' ? baileys.default : baileys.makeWASocket;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = baileys;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Load commands ----------
const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
  commands.set(mod.default.name, mod.default);
}
console.log(`Loaded ${commands.size} command(s): ${[...commands.keys()].join(', ')}`);

function getText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Bot ----------
let sock = null;
let isOnline = false;
let canPair = false;

async function startBot() {
  const auth = supabase
    ? await useSupabaseAuthState(baileys)
    : await useMultiFileAuthState(config.sessionDir);
  const { state, saveCreds } = auth;
  const { version } = await fetchLatestBaileysVersion();

  canPair = false;

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    // Pairing codes need a standard browser identity
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // A QR event means the socket is ready to be paired
    if (qr) canPair = true;

    if (connection === 'open') {
      isOnline = true;
      canPair = false;
      console.log(`✅ ${config.botName} is online!`);
    }

    if (connection === 'close') {
      isOnline = false;
      canPair = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.log(`Connection closed (code ${code}).`, loggedOut ? 'Logged out.' : 'Reconnecting...');
      if (loggedOut && auth.clear) {
        await auth.clear();
        console.log('Session cleared. Open the pair link to link again.');
      }
      startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const from = msg.key.remoteJid;
        if (!from || from === 'status@broadcast') continue;

        const isGroup = from.endsWith('@g.us');
        const sender = isGroup
          ? msg.key.participantAlt || msg.key.participant
          : msg.key.remoteJidAlt || from;

        saveUser(sender, msg.pushName || null);

        const body = getText(msg).trim();
        if (!body.startsWith(config.prefix)) continue;

        const [name, ...args] = body.slice(config.prefix.length).split(/\s+/);
        const cmd = commands.get(name.toLowerCase());
        if (!cmd) continue;

        await cmd.run({ sock, msg, from, sender, args, commands, config });
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
}

// ---------- Web server (needed by Render + pair link) ----------
const app = express();
const PAIR_KEY = process.env.PAIR_KEY;

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${config.botName}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center}
input,button{width:100%;padding:12px;margin:6px 0;font-size:16px;box-sizing:border-box}
.code{font-size:32px;letter-spacing:4px;font-weight:700;margin:16px 0}
</style></head>
<body><h2>${config.botName}</h2>${body}</body></html>`;

app.get('/', (req, res) => {
  const status = isOnline ? '✅ Bot is online' : '⏳ Bot is not linked or still connecting';
  res.send(
    page(`<p>${status}</p>
<form action="/pair" method="get">
<input name="number" placeholder="Your number e.g. 2348012345678" inputmode="numeric" required>
<input name="key" type="password" placeholder="Pair key" required>
<button type="submit">Get pairing code</button>
</form>`)
  );
});

app.get('/pair', async (req, res) => {
  try {
    if (!PAIR_KEY || req.query.key !== PAIR_KEY) {
      return res.status(403).send(page('<p>❌ Wrong pair key.</p><a href="/">Back</a>'));
    }
    const number = String(req.query.number || '').replace(/\D/g, '');
    if (!number) {
      return res.status(400).send(page('<p>Enter your number with country code.</p><a href="/">Back</a>'));
    }
    if (!sock) {
      return res.status(503).send(page('<p>Bot is starting, try again in a few seconds.</p><a href="/">Back</a>'));
    }
    if (sock.authState.creds.registered || isOnline) {
      return res.send(page('<p>✅ Already linked.</p>'));
    }

    // Wait up to 15 seconds for the socket to be ready for pairing
    for (let i = 0; i < 30 && !canPair; i++) await sleep(500);
    if (!canPair) {
      return res.status(503).send(page('<p>Not ready yet. Wait 10 seconds and try again.</p><a href="/">Back</a>'));
    }

    const code = await sock.requestPairingCode(number);
    const pretty = code.match(/.{1,4}/g)?.join('-') || code;
    res.send(
      page(`<p>Enter this code in WhatsApp:<br>Settings → Linked Devices → Link a Device → Link with phone number instead</p>
<div class="code">${pretty}</div><p>Use it right away. It expires in about a minute. Don't refresh this page, because that makes a new code and cancels this one.</p>`)
    );
  } catch (err) {
    console.error('Pair error:', err);
    res.status(500).send(page(`<p>Could not get a code: ${err.message}</p><a href="/">Back</a>`));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web server on port ${PORT}`));

startBot();
