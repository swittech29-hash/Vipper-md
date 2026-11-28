// Admin dashboard: shows linked numbers and the people who use the bot.
import { page, esc, svg, CSS } from './portal.js';

export const loginPage = (botName, message = '') =>
  page(
    botName,
    `${message ? `<p class="msg" style="color:#f87171">${esc(message)}</p>` : ''}
<form method="post" action="/admin/login">
  <label for="key">Admin Key</label>
  <div class="field"><span class="ico">${svg('lock')}</span>
    <input id="key" name="key" type="password" placeholder="Enter admin key" autocomplete="off" required></div>
  <button class="btn primary" type="submit" style="margin-top:24px">Open Dashboard</button>
</form>`,
    'ADMIN'
  );

const DASH_CSS = `
body{display:block;padding:20px 16px 40px}
.wrap{max-width:560px;margin:0 auto}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.top h1{text-align:left;font-size:22px}
.top .sub{margin:4px 0 0;text-align:left;letter-spacing:.3em}
.out{background:#121528;border:1px solid #1c2b3f;color:var(--teal);border-radius:999px;padding:10px 16px;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.tile{background:#0b0b1c;border:1px solid #1b1f33;border-radius:20px;padding:16px 8px;text-align:center}
.tile b{display:block;font:700 26px "Space Grotesk",Inter,sans-serif;color:#d8f6ff}
.tile span{font-size:11px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}
.panel{background:#0b0b1c;border:1px solid #1b1f33;border-radius:24px;padding:18px;margin-bottom:16px}
.panel h2{margin:0 0 12px;font-size:12px;letter-spacing:.2em;color:var(--teal);text-transform:uppercase;font-weight:600}
.row{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #151830}
.row:first-of-type{border-top:0}
.grow{flex:1;min-width:0}
.name{color:#e6ecff;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub2{color:var(--muted);font-size:12px;margin-top:2px}
.right{color:var(--muted);font-size:12px;white-space:nowrap;text-align:right}
.dot{width:10px;height:10px;border-radius:50%;background:#3b3f55;flex:none}
.dot.on{background:#22c55e;box-shadow:0 0 10px rgba(34,197,94,.7)}
.dot.wait{background:#f59e0b}
.empty{margin:6px 0;color:var(--muted);font-size:13px;text-align:center}
.search{width:100%;height:46px;padding:0 18px;margin-bottom:6px;font-size:14px}
.upd{text-align:center;color:var(--muted);font-size:11px;margin-top:10px}
`;

export const dashboardPage = (botName) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(botName)} · Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>${CSS}${DASH_CSS}</style></head>
<body><div class="wrap">
  <div class="top">
    <div><h1>${esc(botName)}</h1><p class="sub">DASHBOARD</p></div>
    <form method="post" action="/admin/logout"><button class="out" type="submit">Log out</button></form>
  </div>

  <div class="tiles">
    <div class="tile"><b id="s-online">–</b><span>Online</span></div>
    <div class="tile"><b id="s-linked">–</b><span>Linked</span></div>
    <div class="tile"><b id="s-users">–</b><span>Users</span></div>
  </div>

  <section class="panel">
    <h2>Linked numbers</h2>
    <div id="numbers"></div>
  </section>

  <section class="panel">
    <h2>People who messaged the bot</h2>
    <input class="search" id="q" type="search" placeholder="Search name or number" autocomplete="off">
    <div id="users"></div>
  </section>

  <p class="upd" id="upd">Loading…</p>
</div>
<script>
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var users = [];

  function ago(ms){
    var s = Math.max(0, Math.floor(ms/1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s/60);
    if (m < 60) return m + 'm';
    var h = Math.floor(m/60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    var d = Math.floor(h/24);
    return d + 'd ' + (h % 24) + 'h';
  }
  function numberOf(jid){
    var j = String(jid);
    if (j.indexOf('@lid') > -1) return 'hidden id';
    return '+' + j.split('@')[0].split(':')[0];
  }
  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderNumbers(list, now){
    var box = $('numbers');
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'empty', 'No numbers linked yet.')); return; }
    list.forEach(function(s){
      var row = el('div', 'row');
      row.appendChild(el('span', 'dot ' + (s.online ? 'on' : (s.linked ? 'wait' : ''))));
      var mid = el('div', 'grow');
      mid.appendChild(el('div', 'name', s.id === 'main' ? 'Main number' : '+' + s.id));
      mid.appendChild(el('div', 'sub2', s.name || ''));
      row.appendChild(mid);
      var status = s.online
        ? 'Online' + (s.since ? ' · ' + ago(now - s.since) : '')
        : (s.linked ? 'Reconnecting…' : 'Waiting to link');
      row.appendChild(el('div', 'right', status));
      box.appendChild(row);
    });
  }

  function renderUsers(){
    var q = $('q').value.toLowerCase();
    var box = $('users');
    box.textContent = '';
    var shown = 0;
    users.forEach(function(u){
      var num = numberOf(u.jid);
      if (q && String(u.name || '').toLowerCase().indexOf(q) < 0 && num.indexOf(q) < 0) return;
      shown++;
      var row = el('div', 'row');
      var mid = el('div', 'grow');
      mid.appendChild(el('div', 'name', u.name || 'Unknown'));
      mid.appendChild(el('div', 'sub2', num));
      row.appendChild(mid);
      row.appendChild(el('div', 'right', u.last_seen ? ago(Date.now() - new Date(u.last_seen).getTime()) + ' ago' : ''));
      box.appendChild(row);
    });
    if (!shown) box.appendChild(el('p', 'empty', users.length ? 'No match.' : 'No users yet.'));
  }

  function load(){
    fetch('/admin/data', { credentials: 'same-origin', cache: 'no-store' })
      .then(function(r){
        if (r.status === 401) { location.href = '/admin'; throw new Error('login'); }
        return r.json();
      })
      .then(function(d){
        var online = d.sessions.filter(function(s){ return s.online; }).length;
        $('s-online').textContent = online;
        $('s-linked').textContent = d.sessions.length;
        $('s-users').textContent = d.users.enabled ? d.users.total : '–';
        renderNumbers(d.sessions, d.now);

        if (!d.users.enabled) {
          users = [];
          $('users').textContent = '';
          $('users').appendChild(el('p', 'empty', 'Connect Supabase to keep a list of users.'));
        } else if (d.users.error) {
          users = [];
          $('users').textContent = '';
          $('users').appendChild(el('p', 'empty', 'Could not load users: ' + d.users.error));
        } else {
          users = d.users.recent;
          renderUsers();
        }
        $('upd').textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · refreshes every 10s';
      })
      .catch(function(){});
  }

  $('q').addEventListener('input', renderUsers);
  load();
  setInterval(load, 10000);
})();
</script>
</body></html>`;
