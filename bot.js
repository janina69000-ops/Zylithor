// TapSwap-style Telegram Mini App: বট + সার্ভার + গেম পেজ, সব এক ফাইলে।
// চালানো: BOT_TOKEN=xxx WEB_APP_URL=https://your-site.com node bot.js
// দরকার: Node.js 18+ (কোনো npm install লাগবে না)

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL;
const PORT = process.env.PORT || 3000;
const DB_FILE = 'data.json';

const MAX_ENERGY = 500;
const REGEN_PER_SEC = 1;
const MAX_TAPS_PER_REQUEST = 50;
const LEVELS = [
  { name: 'Bronze', min: 0 },
  { name: 'Silver', min: 5000 },
  { name: 'Gold', min: 25000 },
  { name: 'Platinum', min: 100000 },
];

if (!BOT_TOKEN || !WEB_APP_URL) {
  console.error('BOT_TOKEN এবং WEB_APP_URL এনভায়রনমেন্ট ভ্যারিয়েবল সেট করুন।');
  process.exit(1);
}

// ---------- ডাটাবেস (সহজ JSON ফাইল; পরে Supabase/Postgres-এ নেবেন) ----------
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = {}; }
let dirty = false;
setInterval(() => {
  if (dirty) { fs.writeFileSync(DB_FILE, JSON.stringify(db)); dirty = false; }
}, 5000);

function getUser(id, name) {
  if (!db[id]) db[id] = { name, coins: 0, energy: MAX_ENERGY, ts: Date.now() };
  const u = db[id];
  const now = Date.now();
  u.energy = Math.min(MAX_ENERGY, u.energy + Math.floor((now - u.ts) / 1000) * REGEN_PER_SEC);
  u.ts = now;
  return u;
}

function levelOf(coins) {
  let l = LEVELS[0];
  for (const x of LEVELS) if (coins >= x.min) l = x;
  return l.name;
}

function publicUser(u) {
  return { coins: u.coins, energy: u.energy, maxEnergy: MAX_ENERGY, level: levelOf(u.coins) };
}

// ---------- Telegram initData যাচাই (চিট ঠেকানোর জন্য জরুরি) ----------
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()]
    .map(([k, v]) => k + '=' + v)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc !== hash) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date'));
  if (age > 86400) return null;
  try { return JSON.parse(params.get('user')); } catch (e) { return null; }
}

// ---------- গেম পেজ ----------
const HTML = `<!doctype html>
<html lang="bn"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>TapGame</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;user-select:none}
  body{margin:0;min-height:100vh;background:linear-gradient(#2a2140,#171225);color:#fff;
       font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:16px}
  .top{display:flex;justify-content:space-between;width:100%;max-width:420px;font-size:18px}
  .pill{background:#ffffff18;border-radius:12px;padding:8px 14px}
  #coins{font-size:44px;font-weight:700;margin:24px 0 8px}
  #coin{width:260px;height:260px;border-radius:50%;margin:20px 0;border:0;
        background:radial-gradient(circle at 35% 30%,#fff3b0,#f5b72e 55%,#a8650a);
        box-shadow:0 10px 40px #f5b72e55;font-size:90px;color:#a8650a;font-weight:800;
        transition:transform .06s}
  #coin:active{transform:scale(.95)}
  .bar{width:100%;max-width:420px;height:12px;background:#ffffff22;border-radius:6px;overflow:hidden}
  #fill{height:100%;background:#ffd24a;width:100%;transition:width .2s}
  .pop{position:fixed;font-size:28px;font-weight:700;pointer-events:none;animation:up .8s forwards}
  @keyframes up{to{transform:translateY(-90px);opacity:0}}
</style></head>
<body>
  <div class="top"><div class="pill" id="level">...</div><div class="pill" id="energyTxt">0/0</div></div>
  <div id="coins">0</div>
  <button id="coin">T</button>
  <div class="bar"><div id="fill"></div></div>
<script>
  var tg = window.Telegram.WebApp;
  tg.ready(); tg.expand();
  var initData = tg.initData;
  var state = { coins: 0, energy: 0, maxEnergy: 500, level: '' };
  var pending = 0;

  function render() {
    document.getElementById('coins').textContent = state.coins.toLocaleString();
    document.getElementById('level').textContent = state.level;
    document.getElementById('energyTxt').textContent = Math.floor(state.energy) + '/' + state.maxEnergy;
    document.getElementById('fill').style.width = (state.energy / state.maxEnergy * 100) + '%';
  }

  function post(url, body) {
    body.initData = initData;
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  function sync() {
    var n = pending; pending = 0;
    if (n === 0) return;
    post('/api/tap', { taps: n }).then(function (s) { if (s.coins !== undefined) { state = s; render(); } });
  }

  document.getElementById('coin').addEventListener('pointerdown', function (e) {
    if (state.energy < 1) return;
    state.energy -= 1; state.coins += 1; pending += 1;
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    var p = document.createElement('div');
    p.className = 'pop'; p.textContent = '+1';
    p.style.left = (e.clientX - 10) + 'px'; p.style.top = (e.clientY - 30) + 'px';
    document.body.appendChild(p);
    setTimeout(function () { p.remove(); }, 800);
    render();
    if (pending >= 40) sync();
  });

  setInterval(sync, 1000);
  setInterval(function () {
    if (state.energy < state.maxEnergy) { state.energy = Math.min(state.maxEnergy, state.energy + 1); render(); }
  }, 1000);

  post('/api/me', {}).then(function (s) { state = s; render(); });
</script>
</body></html>`;

// ---------- HTTP সার্ভার ----------
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.split('?')[0] === '/') return send(res, 200, HTML, 'text/html; charset=utf-8');

  if (req.method === 'POST' && (req.url === '/api/me' || req.url === '/api/tap')) {
    const body = await readBody(req);
    const tgUser = verifyInitData(body.initData);
    if (!tgUser) return send(res, 401, { error: 'invalid initData' });
    const u = getUser(tgUser.id, tgUser.first_name || 'user');

    if (req.url === '/api/tap') {
      let taps = Math.floor(Number(body.taps) || 0);
      taps = Math.max(0, Math.min(taps, MAX_TAPS_PER_REQUEST, u.energy));
      u.energy -= taps;
      u.coins += taps;
      dirty = true;
    }
    return send(res, 200, publicUser(u));
  }

  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log('সার্ভার চালু, পোর্ট ' + PORT));

// ---------- বট (long polling) ----------
const API = 'https://api.telegram.org/bot' + BOT_TOKEN;

async function tgCall(method, payload) {
  const r = await fetch(API + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return r.json();
}

async function pollBot() {
  let offset = 0;
  while (true) {
    try {
      const r = await tgCall('getUpdates', { offset, timeout: 30 });
      for (const up of r.result || []) {
        offset = up.update_id + 1;
        const msg = up.message;
        if (msg && msg.text && msg.text.startsWith('/start')) {
          await tgCall('sendMessage', {
            chat_id: msg.chat.id,
            text: 'স্বাগতম! নিচের বাটনে চাপ দিয়ে গেম খুলুন 👇',
            reply_markup: { inline_keyboard: [[{ text: '🪙 Play', web_app: { url: WEB_APP_URL } }]] },
          });
        }
      }
    } catch (e) {
      console.error('poll error:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
pollBot();
