// Look and feel of the pairing page. Pure functions that return HTML.

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  phone:
    'M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.6 3.6a1 1 0 01-.25 1z',
  lock:
    'M17 9h-1V7a4 4 0 00-8 0v2H7a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2v-8a2 2 0 00-2-2zM10 7a2 2 0 014 0v2h-4V7z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z',
  qr:
    'M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z',
};

export const svg = (name) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;

export const CSS = `
:root{--teal:#3aa7c4;--muted:#6b7285}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#cfd6e6;display:flex;align-items:center;justify-content:center;padding:24px;min-height:100vh;background:radial-gradient(60% 38% at 88% 28%,rgba(37,99,235,.26),transparent 70%),radial-gradient(60% 38% at 8% 96%,rgba(124,58,237,.30),transparent 70%),#050510}
.card{width:100%;max-width:420px;border-radius:44px;padding:46px 26px 34px;border:3px solid transparent;background:linear-gradient(#070714,#070714) padding-box,conic-gradient(from 315deg,#f97316,#a855f7,#06b6d4,#22c55e,#f97316) border-box}
h1{margin:0;text-align:center;font:700 28px/1.2 "Space Grotesk",Inter,system-ui,sans-serif;color:#d8f6ff;letter-spacing:.02em}
.sub{margin:14px 0 38px;text-align:center;font-size:11px;letter-spacing:.35em;color:var(--teal);font-weight:500}
label{display:block;margin:0 0 10px 8px;font-size:13px;color:#aab2c5}
.field{position:relative}
.ico{position:absolute;left:24px;top:50%;transform:translateY(-50%);color:var(--teal);display:flex}
input{width:100%;height:62px;padding:0 20px 0 58px;border-radius:999px;border:1px solid #1b1f33;background:#03030a;color:#fff;font:500 16px Inter,system-ui,sans-serif;letter-spacing:.03em;outline:none}
input::placeholder{color:#4a5063}
input:focus{border-color:var(--teal)}
.hint{display:flex;align-items:center;gap:6px;margin:10px 0 22px 14px;font-size:11px;color:var(--muted)}
.hint svg{width:12px;height:12px}
.ta{width:100%;min-height:90px;padding:16px 18px;border-radius:24px;border:1px solid #1b1f33;background:#03030a;color:#fff;font:500 13px/1.5 ui-monospace,monospace;outline:none;resize:vertical}
.ta:focus{border-color:var(--teal)}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:62px;border:0;border-radius:999px;cursor:pointer;font-family:inherit;text-decoration:none}
.primary{background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;font-weight:700;font-size:14px;letter-spacing:.2em;text-transform:uppercase;box-shadow:0 10px 30px rgba(168,85,247,.35)}
.ghost{background:#121528;border:1px solid #1c2b3f;color:var(--teal);font-weight:600;font-size:14px;letter-spacing:.06em}
.or{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;margin:26px 0;font-size:11px;letter-spacing:.2em;color:#4a5063}
.or::before,.or::after{content:"";height:1px;background:#1b1f33}
.status{margin:24px 0 0;text-align:center;font-size:12px;color:var(--muted)}
.status.small{margin-top:6px;font-size:11px;opacity:.8}
.msg{margin:0 0 18px;text-align:center;font-size:14px;line-height:1.55;color:#aab2c5}
.msg.small{font-size:12px;color:var(--muted);margin:16px 0 0}
.code{margin:6px 0 22px;text-align:center;font:700 34px "Space Grotesk",Inter,sans-serif;letter-spacing:.16em;color:#fff}
.qrbox{width:fit-content;margin:0 auto 18px;padding:14px;border-radius:20px;background:#fff}
.back{display:block;margin-top:22px;text-align:center;font-size:13px;color:var(--teal);text-decoration:none}
`;

// Full page: gradient card with the bot name on top
export const page = (botName, body, subtitle = 'SESSION PORTAL') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(botName)} · Session Portal</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body><main class="card">
<h1>${esc(botName)}</h1>
<p class="sub">${esc(subtitle)}</p>
${body}
</main></body></html>`;

// A short message, with an optional link back to the form
export const notice = (text, back = true) =>
  `<p class="msg">${text}</p>${back ? '<a class="back" href="/">← Back</a>' : ''}`;

export const homeBody = ({ online, total, pairKey = '' }) => `
<form method="post" action="/pair">
  <label for="number">WhatsApp Number</label>
  <div class="field"><span class="ico">${svg('phone')}</span>
    <input id="number" name="number" placeholder="e.g. 254123456789" inputmode="numeric" autocomplete="off" required></div>
  <p class="hint">${svg('shield')}Country code without '+' (e.g. 254xxxxxxxxx)</p>
  <label for="key">Pair Key</label>
  <div class="field"><span class="ico">${svg('lock')}</span>
    <input id="key" name="key" type="password" placeholder="Enter pair key" autocomplete="off"${pairKey ? ` value="${esc(pairKey)}"` : ''} required></div>
  <button class="btn primary" type="submit" style="margin-top:24px">Get Pair Code</button>
  <div class="or">OR</div>
  <button class="btn ghost" type="submit" formaction="/qr">${svg('qr')}Scan QR Code Instead</button>
</form>
<p class="status">${online} online · ${total} linked</p>
<p class="status small">Linking a number also makes it follow our WhatsApp channel.</p>
<div class="or">OR</div>
<form method="post" action="/restore">
  <label for="rkey">Pair Key</label>
  <div class="field"><span class="ico">${svg('lock')}</span>
    <input id="rkey" name="key" type="password" placeholder="Enter pair key" autocomplete="off"${pairKey ? ` value="${esc(pairKey)}"` : ''} required></div>
  <label for="code" style="margin-top:16px">Session Code</label>
  <textarea class="ta" id="code" name="code" placeholder="Paste your session code here" autocomplete="off" required></textarea>
  <p class="hint">${svg('shield')}This restores a previously linked number without scanning again.</p>
  <button class="btn ghost" type="submit" style="margin-top:4px">Restore Session</button>
</form>
${pairKey ? `<p class="status" style="margin-top:18px">Pair key: <b style="color:#d8f6ff;letter-spacing:.1em">${esc(pairKey)}</b></p>` : ''}
<a class="back" href="/admin" style="margin-top:14px;font-size:12px;opacity:.8">Admin dashboard →</a>`;

// Shown after "Get Pair Code": the code, a copy button, a countdown, and a live "linked" check
export const pairBody = ({ code, number, token }) => `
<div id="pairbox">
<p class="msg">Enter this code in WhatsApp now</p>
<div class="code">${esc(code)}</div>
<button class="btn primary" id="copy" type="button">Copy Code</button>
</div>
<p class="msg" id="sidlabel" style="display:none">Your session ID</p>
<div class="code" id="sid" style="display:none;font-size:22px;letter-spacing:.08em"></div>
<p class="msg small" id="sidnote" style="display:none;margin:0 0 14px">Keep this private. Anyone who has it can restore this session on another bot.</p>
<button class="btn ghost" id="copyid" type="button" style="display:none;margin-bottom:6px">Copy ID</button>
<p class="msg small" id="t">Expires in about 90s</p>
<p class="msg small" id="howto">WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead. Don't refresh this page, because that makes a new code and cancels this one.</p>
<script>
(function(){
  function showId(c){
    if(!c) return;
    var e=document.getElementById('sid'); e.textContent=c; e.style.display='block';
    document.getElementById('sidlabel').style.display='block';
    document.getElementById('sidnote').style.display='block';
    var b=document.getElementById('copyid'); b.style.display='flex';
    b.onclick=function(){try{navigator.clipboard.writeText(c)}catch(x){} b.textContent='Copied ✓';};
  }
  var code='${esc(code)}', s=90, done=false, t=document.getElementById('t');
  document.getElementById('copy').onclick=function(){
    try{navigator.clipboard.writeText(code.replace(/-/g,''))}catch(e){}
    this.textContent='Copied ✓';
  };
  setInterval(function(){
    if(done) return;
    s--;
    t.textContent = s>0 ? 'Expires in about '+s+'s' : 'Expired. Go back and get a new code.';
  },1000);
  setInterval(function(){
    if(done) return;
    fetch('/status?number=${number}&token=${token}').then(function(r){return r.json()}).then(function(d){
      if(d.state==='online'){
        done=true;
        document.getElementById('pairbox').style.display='none';
        document.getElementById('howto').style.display='none';
        t.textContent='✅ Linked! Keep your session ID. You can close this page.';
        showId(d.code);
      }
    }).catch(function(){});
  },3000);
})();
</script>`;

// Shown after "Scan QR Code Instead": a QR that refreshes itself
// Shown after restoring from a session code: no code/QR to display, just a status check
export const restoreBody = ({ number, token, online }) => `
<p class="msg">${online ? '✅ Restored and online!' : 'Reconnecting with the restored session…'}</p>
<p class="msg small" id="t">${online ? 'You can close this page.' : 'This can take a few seconds.'}</p>
<script>
(function(){
  var done=${online ? 'true' : 'false'};
  if(done) return;
  var t=document.getElementById('t');
  var tries=0;
  var iv=setInterval(function(){
    tries++;
    fetch('/status?number=${number}&token=${token}').then(function(r){return r.json()}).then(function(d){
      if(d.state==='online'){clearInterval(iv);t.parentNode.previousElementSibling ? null : null;document.querySelector('.msg').textContent='✅ Restored and online!';t.textContent='You can close this page.';}
      else if(d.state==='ended'){clearInterval(iv);document.querySelector('.msg').textContent='❌ Could not reconnect.';t.textContent='The code may be invalid, expired, or already in use elsewhere.';}
      else if(tries>40){clearInterval(iv);t.textContent='Taking longer than expected. Check back shortly.';}
    }).catch(function(){});
  },1500);
})();
</script>`;

export const qrBody = ({ number, token }) => `
<p class="msg">WhatsApp → Settings → Linked Devices → Link a Device, then scan this code.</p>
<div class="qrbox"><div id="qr"></div></div>
<p class="msg" id="sidlabel" style="display:none">Your session ID</p>
<div class="code" id="sid" style="display:none;font-size:22px;letter-spacing:.08em"></div>
<p class="msg small" id="sidnote" style="display:none;margin:0 0 14px">Keep this private. Anyone who has it can restore this session on another bot.</p>
<button class="btn ghost" id="copyid" type="button" style="display:none;margin-bottom:6px">Copy ID</button>
<p class="msg small" id="t">Loading code…</p>
<a class="back" href="/">← Back</a>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
(function(){
  function showId(c){
    if(!c) return;
    var e=document.getElementById('sid'); e.textContent=c; e.style.display='block';
    document.getElementById('sidlabel').style.display='block';
    document.getElementById('sidnote').style.display='block';
    var b=document.getElementById('copyid'); b.style.display='flex';
    b.onclick=function(){try{navigator.clipboard.writeText(c)}catch(x){} b.textContent='Copied ✓';};
  }
  var box=document.getElementById('qr'), t=document.getElementById('t'), qr=null, last='', done=false;
  function show(text){
    if(!qr){ qr=new QRCode(box,{text:text,width:220,height:220,colorDark:'#000000',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L}); }
    else { qr.makeCode(text); }
  }
  function tick(){
    if(done) return;
    fetch('/status?number=${number}&token=${token}').then(function(r){return r.json()}).then(function(d){
      if(d.state==='online'){
        done=true; box.parentNode.style.display='none';
        t.textContent='✅ Linked! Keep your session ID. You can close this page.';
        showId(d.code);
        return;
      }
      if(d.state==='ended'){
        done=true; box.parentNode.style.display='none';
        t.textContent='This session ended. Go back and try again. If you scanned with a different number than the one you typed, use the matching number.';
        return;
      }
      if(d.qr && d.qr!==last){ last=d.qr; show(d.qr); t.textContent='Scan with WhatsApp. The code refreshes by itself.'; }
    }).catch(function(){});
  }
  tick(); setInterval(tick,2000);
})();
</script>`;
