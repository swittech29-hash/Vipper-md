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
const commands = new Map(); // unique commands by name (used by the menu)
const lookup = new Map(); // name or alias -> command
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
  const list = Array.isArray(mod.default) ? mod.default : [mod.default];
  for (const cmd of list) {
    commands.set(cmd.name, cmd);
    lookup.set(cmd.name, cmd);
    for (const alias of cmd.aliases || []) lookup.set(alias, cmd);
  }
}
console.log(`Loaded ${commands.size} command(s): ${[...commands.keys()].join(', ')}`);

function getText(msg) {
  // Unwrap disappearing-message and view-once wrappers
  const m =
    msg.message?.ephemeralMessage?.message ||
    msg.message?.viewOnceMessage?.message ||
    msg.message?.documentWithCaptionMessage?.message ||
    msg.message;
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

// Cache the WhatsApp version so we don't fetch it on every pair request
let cachedVersion = null;
async function getVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version, error } = await fetchLatestBaileysVersion();
    if (!error) cachedVersion = version;
    return version;
  } catch {
    return undefined;
  }
}

// Start the bot and retry if startup fails
function boot() {
  startBot().catch((err) => {
    console.error('Start failed, retrying in 5s:', err.message);
    setTimeout(boot, 5000);
  });
}

// ---------- Bot ----------
let sock = null;
let isOnline = false;
let canPair = false;
let gen = 0; // each new socket gets a number; events from old sockets are ignored

async function startBot() {
  const myGen = ++gen;

  const auth = supabase
    ? await useSupabaseAuthState(baileys)
    : await useMultiFileAuthState(config.sessionDir);
  const { state, saveCreds } = auth;
  const version = await getVersion();

  if (myGen !== gen) return; // a newer socket was requested while loading

  canPair = false;

  const s = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    qrTimeout: 120000, // keep the pairing window open longer
  });
  sock = s;

  s.ev.on('creds.update', saveCreds);

  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (myGen !== gen) return;

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
      console.log(`Connection closed (code ${code}).`, loggedOut ? 'Logged out.' : '');

      if (loggedOut && auth.clear) {
        await auth.clear();
        console.log('Session cleared.');
      }

      // Pairing window ran out and nothing is linked: stay idle until a new pair request
      const idle = !s.authState.creds.registered && code === DisconnectReason.timedOut && !loggedOut;
      if (idle) {
        console.log('Pairing window ended. Waiting for a new pair request.');
        return;
      }

      console.log('Reconnecting...');
      boot();
    }
  });

  s.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const from = msg.key.remoteJid;
        if (!from || from === 'status@broadcast') continue;

        // Live messages, plus recent ones sent from the owner's own phone
        const age = Date.now() / 1000 - Number(msg.messageTimestamp || 0);
        if (type !== 'notify' && age > 30) continue;

        const isGroup = from.endsWith('@g.us');
        const sender = isGroup
          ? msg.key.participantAlt || msg.key.participant
          : msg.key.remoteJidAlt || from;

        if (!msg.key.fromMe) saveUser(sender, msg.pushName || null);

        const body = getText(msg).trim();
        if (body) console.log(`[msg] ${msg.key.fromMe ? 'me' : 'them'} ${from}: ${body.slice(0, 60)}`);
        if (!body.startsWith(config.prefix)) continue;

        const [name, ...args] = body.slice(config.prefix.length).split(/\s+/);
        const cmd = lookup.get(name.toLowerCase());
        if (!cmd) continue;

        const isOwner = !!msg.key.fromMe;
        const reply = (text, extra = {}) =>
          s.sendMessage(from, { text, ...extra }, { quoted: msg });

        // Permission checks
        if (cmd.owner && !isOwner) {
          await reply('❌ Only the owner can use this command.');
          continue;
        }
        if ((cmd.group || cmd.admin) && !isGroup) {
          await reply('❌ This command works in groups only.');
          continue;
        }
        if (cmd.admin && !isOwner) {
          const meta = await s.groupMetadata(from);
          const isAdmin = meta.participants.some(
            (p) => p.admin && [p.id, p.lid, p.phoneNumber].includes(sender)
          );
          if (!isAdmin) {
            await reply('❌ Only group admins can use this command.');
            continue;
          }
        }

        try {
          await cmd.run({
            sock: s, msg, from, sender, args, commands, config,
            isOwner, isGroup, text: args.join(' '), reply,
          });
        } catch (err) {
          console.error(`Command ${cmd.name} failed:`, err);
          const m = String(err?.message || '');
          await reply(
            /not-authorized|forbidden|admin/i.test(m)
              ? '❌ I need to be a group admin to do that.'
              : '❌ Something went wrong running that command.'
          ).catch(() => {});
        }
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });
}

// Start a brand new socket so the pairing code gets its full lifetime
async function freshSocket() {
  const old = sock;
  const p = startBot(); // bumps gen right away, so the old socket's events are ignored
  try {
    old?.end(undefined);
  } catch {}
  await p;
}

// ---------- Web server (needed by Render + pair link) ----------
const app = express();
const PAIR_KEY = process.env.PAIR_KEY;
let pairBusy = false;

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
<p><b>Tip:</b> open WhatsApp first: Settings → Linked Devices → Link a Device → Link with phone number instead. Then tap the button below and enter the code quickly.</p>
<form action="/pair" method="get">
<input name="number" placeholder="Your number e.g. 2348012345678" inputmode="numeric" required>
<input name="key" type="password" placeholder="Pair key" required>
<button type="submit">Get pairing code</button>
</form>`)
  );
});

app.get('/pair', async (req, res) => {
  if (pairBusy) {
    return res.status(429).send(page('<p>Another request is in progress. Wait a few seconds.</p><a href="/">Back</a>'));
  }
  pairBusy = true;
  try {
    if (!PAIR_KEY || req.query.key !== PAIR_KEY) {
      return res.status(403).send(page('<p>❌ Wrong pair key.</p><a href="/">Back</a>'));
    }
    const number = String(req.query.number || '').replace(/\D/g, '');
    if (!number) {
      return res.status(400).send(page('<p>Enter your number with country code.</p><a href="/">Back</a>'));
    }
    if (isOnline) {
      return res.send(page('<p>✅ Already linked and online.</p>'));
    }

    // Always start a fresh socket so the code is as new as possible
    await freshSocket();
    for (let i = 0; i < 40 && !canPair; i++) await sleep(500);
    if (!canPair) {
      return res.status(503).send(page('<p>Not ready yet. Wait 10 seconds and try again.</p><a href="/">Back</a>'));
    }

    const code = await sock.requestPairingCode(number);
    const pretty = code.match(/.{1,4}/g)?.join('-') || code;
    res.send(
      page(`<p>Enter this code in WhatsApp now:</p>
<div class="code">${pretty}</div>
<button onclick="navigator.clipboard.writeText('${code}')">Copy code</button>
<p id="t">Expires in about 90s</p>
<p>WhatsApp may also show a notification. Tap it to open the code screen. Don't refresh this page, because that makes a new code and cancels this one.</p>
<script>var s=90;setInterval(function(){s--;document.getElementById('t').textContent=s>0?('Expires in about '+s+'s'):'Expired. Go back and get a new code.';},1000);</script>`)
    );
  } catch (err) {
    console.error('Pair error:', err);
    res.status(500).send(page(`<p>Could not get a code: ${err.message}</p><a href="/">Back</a>`));
  } finally {
    pairBusy = false;
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Web server on port ${PORT}`));

boot();
