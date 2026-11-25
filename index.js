import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import express from 'express';
import QRCode from 'qrcode';
import { fileURLToPath, pathToFileURL } from 'url';
import * as baileysNs from '@whiskeysockets/baileys';

import config from './config.js';
import { supabase, saveUser } from './lib/db.js';
import { useSupabaseAuthState } from './lib/supabaseAuth.js';

const baileys =
  baileysNs.default && typeof baileysNs.default === 'object'
    ? baileysNs.default
    : baileysNs;

const makeWASocket =
  typeof baileys.default === 'function'
    ? baileys.default
    : baileysNs.makeWASocket || baileys.makeWASocket;

const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = baileys;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ================= COMMANDS ================= */

const commands = new Map();
const commandsDir = path.join(__dirname, 'commands');

if (fs.existsSync(commandsDir)) {
  for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);

    if (mod.default?.name) {
      commands.set(mod.default.name.toLowerCase(), mod.default);
    }
  }
}

console.log(`Loaded ${commands.size} command(s)`);

function getText(msg) {
  const m = msg.message;
  if (!m) return '';

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

/* ================= BOT STATE ================= */

let sock = null;
let isOnline = false;
let canPair = false;
let starting = false;
let reconnectTimer = null;

let latestQR = null;
let latestQRTime = 0;

let pairingLock = false;
let lastPairRequest = 0;

let connectionState = 'disconnected';
let lastError = '';

/* ================= BOT START ================= */

async function startBot() {
  if (starting) return;

  starting = true;

  try {
    const auth = supabase
      ? await useSupabaseAuthState(baileys)
      : await useMultiFileAuthState(config.sessionDir);

    const { state, saveCreds } = auth;

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 2000,
    });

    canPair = false;
    isOnline = false;
    connectionState = 'connecting';
    latestQR = null;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async update => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQR = qr;
        latestQRTime = Date.now();
        canPair = true;

        console.log('New QR code received');
      }

      if (connection === 'connecting') {
        connectionState = 'connecting';

        // Allow pairing requests after socket initialization.
        canPair = true;
      }

      if (connection === 'open') {
        isOnline = true;
        canPair = false;
        connectionState = 'connected';

        latestQR = null;
        lastError = '';

        console.log(`✅ ${config.botName} connected!`);
      }

      if (connection === 'close') {
        isOnline = false;
        canPair = false;
        connectionState = 'disconnected';
        latestQR = null;

        const code = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        console.log(
          `Connection closed: ${code}`,
          loggedOut ? 'Logged out' : 'Reconnecting'
        );

        if (loggedOut && auth.clear) {
          try {
            await auth.clear();
            console.log('Authentication session cleared');
          } catch (err) {
            console.error('Auth clear error:', err);
          }
        }

        if (reconnectTimer) clearTimeout(reconnectTimer);

        reconnectTimer = setTimeout(() => {
          starting = false;
          startBot().catch(console.error);
        }, loggedOut ? 3000 : 5000);
      }
    });

    /* ================= MESSAGE HANDLER ================= */

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

          if (sender) {
            await saveUser(sender, msg.pushName || null);
          }

          const body = getText(msg).trim();

          if (!body.startsWith(config.prefix)) continue;

          const [name, ...args] = body
            .slice(config.prefix.length)
            .trim()
            .split(/\s+/);

          const cmd = commands.get(name?.toLowerCase());

          if (!cmd) continue;

          await cmd.run({
            sock,
            msg,
            from,
            sender,
            args,
            commands,
            config,
          });
        } catch (err) {
          console.error('Message handler error:', err);
        }
      }
    });

  } catch (err) {
    console.error('Bot startup error:', err);

    connectionState = 'error';
    lastError = err.message || 'Startup failed';
    starting = false;

    if (reconnectTimer) clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(() => {
      startBot().catch(console.error);
    }, 10000);

    return;
  }

  starting = false;
}

/* ================= WEB SERVER ================= */

const app = express();
const PORT = process.env.PORT || 3000;
const PAIR_KEY = process.env.PAIR_KEY;

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function statusData() {
  return {
    online: isOnline,
    connecting: starting || connectionState === 'connecting',
    state: connectionState,
    qrAvailable: Boolean(latestQR),
    qrTime: latestQRTime,
    name: config.botName,
  };
}

/* ================= PREMIUM PAGE ================= */

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#080b10">
<title>${escapeHTML(config.botName)} • Connect</title>

<style>
:root {
 --bg:#080b10;
 --card:rgba(255,255,255,.045);
 --border:rgba(255,255,255,.09);
 --text:#f5f7fb;
 --muted:#929ba9;
 --green:#25d366;
 --red:#fb7185;
}

* {
 box-sizing:border-box;
}

body {
 margin:0;
 min-height:100vh;
 padding:24px 15px 40px;
 background:
 radial-gradient(ellipse at 10% 0%,rgba(37,211,102,.13),transparent 42%),
 radial-gradient(ellipse at 100% 70%,rgba(59,130,246,.12),transparent 45%),
 var(--bg);
 color:var(--text);
 font-family:Inter,system-ui,-apple-system,sans-serif;
}

.container {
 max-width:480px;
 margin:auto;
}

.top {
 display:flex;
 justify-content:space-between;
 align-items:center;
 gap:10px;
 margin:10px 0 30px;
}

.brand {
 display:flex;
 align-items:center;
 gap:12px;
}

.logo {
 width:46px;
 height:46px;
 display:grid;
 place-items:center;
 border-radius:16px;
 background:linear-gradient(135deg,#25d366,#119c54);
 color:#06160d;
 font-size:23px;
 font-weight:900;
 box-shadow:0 0 30px #25d36625;
}

.brand h2 {
 font-size:15px;
 margin:0;
}

.brand p {
 color:var(--muted);
 font-size:11px;
 margin:4px 0 0;
}

.status {
 display:flex;
 align-items:center;
 gap:7px;
 padding:8px 11px;
 border:1px solid var(--border);
 background:var(--card);
 border-radius:30px;
 font-size:11px;
 color:var(--muted);
}

.dot {
 width:8px;
 height:8px;
 border-radius:50%;
 background:#f59e0b;
}

.dot.online {
 background:var(--green);
 box-shadow:0 0 12px var(--green);
}

.hero {
 margin:20px 0;
}

.hero h1 {
 font-size:35px;
 line-height:1.12;
 letter-spacing:-1.6px;
 margin:0 0 12px;
}

.hero h1 span {
 color:var(--green);
}

.hero p {
 color:var(--muted);
 line-height:1.7;
 font-size:14px;
}

.card {
 border:1px solid var(--border);
 background:var(--card);
 backdrop-filter:blur(22px);
 -webkit-backdrop-filter:blur(22px);
 border-radius:23px;
 padding:20px;
 margin-bottom:15px;
 box-shadow:0 20px 50px #0002;
}

.label {
 font-size:12px;
 font-weight:700;
 color:#b5bfcc;
 margin-bottom:10px;
}

input {
 width:100%;
 border:1px solid var(--border);
 background:#080b10;
 color:white;
 border-radius:14px;
 padding:15px;
 outline:none;
 font-size:15px;
 margin-bottom:12px;
}

input:focus {
 border-color:#25d36680;
 box-shadow:0 0 0 3px #25d36612;
}

button {
 border:0;
 cursor:pointer;
 font-weight:700;
 font-size:14px;
 border-radius:14px;
 padding:14px;
 transition:.2s;
}

button:active {
 transform:scale(.98);
}

.primary {
 width:100%;
 background:linear-gradient(135deg,#25d366,#18b957);
 color:#06210e;
}

.secondary {
 background:#ffffff0a;
 border:1px solid var(--border);
 color:white;
}

button:disabled {
 opacity:.5;
 cursor:not-allowed;
}

.tabs {
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:8px;
 margin-bottom:17px;
}

.tab {
 padding:12px;
 background:#ffffff07;
 color:var(--muted);
 border:1px solid var(--border);
}

.tab.active {
 color:white;
 background:#25d36613;
 border-color:#25d36655;
}

.hidden {
 display:none!important;
}

.result {
 display:none;
 margin-top:17px;
 padding:15px;
 border-radius:16px;
 background:#25d3660b;
 border:1px solid #25d36625;
}

.result.show {
 display:block;
}

.code {
 font-size:29px;
 font-weight:900;
 letter-spacing:5px;
 color:var(--green);
 text-align:center;
 margin:14px 0;
 word-break:break-word;
}

.copy {
 width:100%;
 background:#ffffff0b;
 color:white;
 border:1px solid var(--border);
}

.timer {
 color:var(--muted);
 text-align:center;
 font-size:12px;
 margin:12px 0;
}

.qrwrap {
 background:white;
 padding:12px;
 width:fit-content;
 max-width:100%;
 margin:16px auto;
 border-radius:17px;
 min-height:220px;
 min-width:220px;
 display:grid;
 place-items:center;
}

.qrwrap img {
 width:210px;
 height:210px;
 object-fit:contain;
 display:block;
}

.placeholder {
 color:#555;
 font-size:12px;
 text-align:center;
 padding:25px;
}

.message {
 font-size:13px;
 line-height:1.7;
 color:var(--muted);
 margin-top:13px;
 text-align:center;
}

.notice {
 padding:13px;
 background:#ffffff05;
 border-radius:14px;
 font-size:12px;
 color:var(--muted);
 line-height:1.7;
}

.settings {
 display:flex;
 justify-content:space-between;
 align-items:center;
 gap:10px;
 font-size:13px;
 padding:12px 0;
 border-bottom:1px solid #ffffff08;
}

.settings:last-child {
 border-bottom:none;
}

.footer {
 text-align:center;
 color:#596271;
 font-size:11px;
 padding:15px 0;
}

.loader {
 width:17px;
 height:17px;
 border:2px solid #0003;
 border-top-color:#06210e;
 border-radius:50%;
 display:inline-block;
 animation:spin .7s linear infinite;
 vertical-align:middle;
}

@keyframes spin {
 to {transform:rotate(360deg)}
}

@media(max-width:360px) {
 .hero h1 {font-size:30px}
 .code {font-size:23px;letter-spacing:3px}
 .card {padding:16px}
}
</style>
</head>

<body>
<div class="container">

<header class="top">
 <div class="brand">
  <div class="logo">✦</div>
  <div>
   <h2>${escapeHTML(config.botName)}</h2>
   <p>WhatsApp connection center</p>
  </div>
 </div>

 <div class="status">
  <span class="dot" id="dot"></span>
  <span id="statusText">Checking...</span>
 </div>
</header>

<section class="hero">
 <h1>Let's get you<br><span>connected.</span></h1>
 <p>One little code. One WhatsApp. A whole lot of bot energy. 🚀</p>
</section>

<div class="card">

<div class="tabs">
 <button class="tab active" id="codeTab" onclick="switchTab('code')">
 Phone Pairing
 </button>

 <button class="tab" id="qrTab" onclick="switchTab('qr')">
 QR Scanner
 </button>
</div>

<div id="codePanel">

<div class="label">WhatsApp phone number</div>

<input
 id="number"
 type="tel"
 placeholder="255XXXXXXXXX"
 inputmode="numeric"
 autocomplete="tel"
>

<div class="label">Access key</div>

<input
 id="key"
 type="password"
 placeholder="Enter your secret pairing key"
>

<button class="primary" id="generate" onclick="generateCode()">
 Generate Pairing Code
</button>

<div class="result" id="codeResult">

<p class="message" id="codeMessage">
Your code is ready. Don't let it escape 😂
</p>

<div class="code" id="pairCode">--------</div>

<button class="copy" onclick="copyCode()">
 Copy pairing code
</button>

<div class="timer" id="countdown"></div>

<button class="secondary" onclick="generateCode()" style="width:100%">
 ↻ Generate fresh code
</button>

</div>
</div>

<div id="qrPanel" class="hidden">

<div class="notice">
 Open WhatsApp → Linked Devices → Link a Device, then scan below.
</div>

<div class="qrwrap" id="qrWrap">
 <div class="placeholder" id="qrPlaceholder">
 Waiting for WhatsApp QR...
 </div>
</div>

<p class="message" id="qrMessage">
 The QR will update automatically when a new one arrives.
</p>

<button class="secondary" onclick="refreshQR()" style="width:100%">
 ↻ Check for fresh QR
</button>

</div>

</div>

<div class="card">

<h3 style="margin:0 0 14px;font-size:15px">⚙️ Connection settings</h3>

<div class="settings">
 <span>Auto-refresh pairing code</span>
 <strong style="color:#25d366">ON</strong>
</div>

<div class="settings">
 <span>QR auto-updates</span>
 <strong style="color:#25d366">ON</strong>
</div>

<div class="settings">
 <span>Live connection monitor</span>
 <strong style="color:#25d366">ON</strong>
</div>

<div class="settings">
 <span>Refresh interval</span>
 <strong>50 seconds</strong>
</div>

</div>

<div class="notice" id="notice">
🔐 Your pairing key is only sent to this server and is not displayed publicly.
Never share your WhatsApp pairing code with anyone.
</div>

<div class="footer">
Made with questionable levels of bot obsession 😂
</div>

</div>

<script>
let currentCode = '';
let expiry = 0;
let autoRefresh = null;
let countdownTimer = null;
let lastQR = '';

function switchTab(tab) {
 document.getElementById('codePanel').classList.toggle('hidden', tab !== 'code');
 document.getElementById('qrPanel').classList.toggle('hidden', tab !== 'qr');

 document.getElementById('codeTab').classList.toggle('active', tab === 'code');
 document.getElementById('qrTab').classList.toggle('active', tab === 'qr');
}

function setStatus(data) {
 const dot = document.getElementById('dot');
 const text = document.getElementById('statusText');

 if (data.online) {
  dot.className = 'dot online';
  text.textContent = 'Connected';
 } else if (data.connecting) {
  dot.className = 'dot';
  text.textContent = 'Connecting';
 } else {
  dot.className = 'dot';
  text.textContent = 'Offline';
 }
}

async function updateStatus() {
 try {
  const r = await fetch('/api/status');
  const data = await r.json();

  setStatus(data);

  if (data.online) {
   document.getElementById('codeMessage').textContent =
    'Ooh! WhatsApp accepted us. We are officially connected 🎉';

   document.getElementById('qrMessage').textContent =
    'Connected successfully! You can close this page.';

   clearInterval(autoRefresh);
  }
 } catch {}
}

async function generateCode(automatic = false) {
 const number = document.getElementById('number').value.trim();
 const key = document.getElementById('key').value;
 const button = document.getElementById('generate');

 if (!number || !key) {
  showMessage('Oops 😂 you forgot the number or secret key.');
  return;
 }

 if (!automatic) {
  button.disabled = true;
  button.innerHTML = '<span class="loader"></span> Asking WhatsApp nicely...';
 }

 try {
  const response = await fetch('/api/pair', {
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({number,key})
  });

  const data = await response.json();

  if (!response.ok) {
   throw new Error(data.error || 'WhatsApp refused to cooperate 😭');
  }

  currentCode = data.code;
  expiry = Date.now() + (data.expiresIn || 50000);

  document.getElementById('pairCode').textContent = data.code;
  document.getElementById('codeResult').classList.add('show');

  document.getElementById('codeMessage').textContent =
   automatic
    ? 'Your previous code expired. Here is a fresh one. Try this one, bestie 😂'
    : 'Ooh! We got a code. Hurry before WhatsApp changes its mind 😭';

  startCountdown();

  clearInterval(autoRefresh);

  autoRefresh = setInterval(() => {
   if (Date.now() >= expiry) {
    generateCode(true);
   }
  }, 2000);

 } catch (err) {
  document.getElementById('codeResult').classList.add('show');

  document.getElementById('codeMessage').textContent =
   funnyError(err.message);

  document.getElementById('pairCode').textContent = 'NO CODE 😭';

  document.getElementById('countdown').textContent =
   'Try again in a few moments.';

 } finally {
  button.disabled = false;
  button.textContent = 'Generate Pairing Code';
 }
}

function funnyError(error) {
 const e = String(error).toLowerCase();

 if (e.includes('rate') || e.includes('429')) {
  return "Bruh 😂 WhatsApp says we've been asking too much. Take a little break.";
 }

 if (e.includes('registered') || e.includes('linked')) {
  return 'This bot already has a WhatsApp account linked. No need to pair again!';
 }

 if (e.includes('timeout') || e.includes('timed out')) {
  return 'Ooh oops! WhatsApp took too long to answer. The internet might be sleepy 😴';
 }

 if (e.includes('connection') || e.includes('not ready')) {
  return 'WhatsApp is still warming up. Give it a few seconds and try again.';
 }

 if (e.includes('number') || e.includes('invalid')) {
  return "Oops! WhatsApp doesn't like that number format. Use country code, e.g. 2557XXXXXXXX.";
 }

 return 'Oops! WhatsApp did not send a code. Maybe it needs coffee ☕ Try again shortly.';
}

function showMessage(message) {
 document.getElementById('codeResult').classList.add('show');
 document.getElementById('codeMessage').textContent = message;
}

async function copyCode() {
 if (!currentCode) return;

 try {
  await navigator.clipboard.writeText(currentCode);

  document.querySelector('.copy').textContent = '✓ Copied!';

  setTimeout(() => {
   document.querySelector('.copy').textContent = 'Copy pairing code';
  }, 2000);
 } catch {
  showMessage('Copy failed. Select the code and copy it manually.');
 }
}

function startCountdown() {
 clearInterval(countdownTimer);

 countdownTimer = setInterval(() => {
  const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));

  document.getElementById('countdown').textContent =
   seconds > 0
    ? 'Code refreshes automatically in ' + seconds + 's'
    : 'Getting a fresh code...';
 }, 500);
}

async function refreshQR() {
 try {
  const response = await fetch('/api/qr');
  const data = await response.json();

  if (data.qr && data.qr !== lastQR) {
   lastQR = data.qr;

   const img = document.createElement('img');
   img.src = data.qr;
   img.alt = 'WhatsApp QR code';

   const wrap = document.getElementById('qrWrap');
   wrap.innerHTML = '';
   wrap.appendChild(img);

   document.getElementById('qrMessage').textContent =
    'Fresh QR received! Scan it quickly.';
  } else if (!data.qr) {
   document.getElementById('qrMessage').textContent =
    data.online
     ? 'Already connected! 🎉'
     : 'Waiting for WhatsApp to generate a QR code...';
  }

  if (data.online) {
   document.getElementById('qrWrap').innerHTML =
    '<div class="placeholder">?
