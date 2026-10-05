// Neon Arena multiplayer server: serves public/index.html and runs 1v1 + Battle Royale rooms over WebSocket.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000, GOAL = 11;
const SP = [[-40,-40],[40,-40],[-40,40],[40,40],[-40,-6],[40,6],[-16,-41],[16,41]];
const WEAP = { ar: { d: 18, r: 100 }, smg: { d: 12, r: 60 }, mk: { d: 45, r: 500 }, sg: { d: 9, r: 850, pel: 8 }, pt: { d: 14, r: 180 } }; // damage, fire interval ms
const PKD = [[0,-12,'h'],[0,12,'a'],[-18,0,'m'],[18,0,'h'],[-30,-30,'a'],[30,30,'m'],[30,-30,'h'],[-30,30,'a'],[-12,-30,'m'],[12,30,'h']];
const CD = [7, 22, 28, 26, 30];
const HEROES = [{ n: 'Phantom', p: 0 }, { n: 'Scout', p: 500 }, { n: 'Medic', p: 800 }, { n: 'Tank', p: 1000 }, { n: 'Gunner', p: 1500 }];
const PERKS = { armor: { p: 400 }, speed: { p: 400 }, gren: { p: 350 }, scav: { p: 350 }, bounty: { p: 500 }, head: { p: 700 } };
const GKEYS = ['ar', 'smg', 'mk', 'sg', 'pt', 'rl'], UPC = [[300, 500, 800], [200, 350, 600], [200, 350, 600]];
const GOALS = { duel: 10, squad: 20, br: 11 };
const lvlOf = xp => Math.floor(Math.sqrt(xp / 60)) + 1;
const coinsFor = (k, hs, win, bounty) => Math.round((k * 12 + hs * 6 + (win ? 100 : 25)) * (bounty ? 1.25 : 1));
function applyBuy(P_, it) {
  const a = String(it).split(':');
  if (a[0] === 'h') { const i = +a[1]; if (!HEROES[i]) return 'Unknown item'; if (P_.heroes[i]) return 'Already owned'; if (P_.coins < HEROES[i].p) return 'Not enough coins'; P_.coins -= HEROES[i].p; P_.heroes[i] = 1; return null; }
  if (a[0] === 'p') { const k = PERKS[a[1]]; if (!k) return 'Unknown item'; if (P_.perks[a[1]]) return 'Already owned'; if (P_.coins < k.p) return 'Not enough coins'; P_.coins -= k.p; P_.perks[a[1]] = 1; return null; }
  if (a[0] === 'u') { const g = a[1], t = +a[2]; if (!GKEYS.includes(g) || !(t >= 0 && t < 3)) return 'Unknown item'; const u = P_.up[g] || (P_.up[g] = [0, 0, 0]), lv = u[t]; if (lv >= 3) return 'Max level'; const c = UPC[t][lv]; if (P_.coins < c) return 'Not enough coins'; P_.coins -= c; u[t] = lv + 1; return null; }
  return 'Unknown item';
}
const MOVE_CHECK = process.env.MOVE_CHECK !== 'off'; // set MOVE_CHECK=off only for local debugging
let MAPB = []; try { MAPB = JSON.parse(fs.readFileSync(path.join(__dirname, 'mapdata.json'), 'utf8')); } catch (e) { console.warn('mapdata.json missing: movement validation disabled'); }
const solidAt = (x, z, y, r) => { for (const o of MAPB) { if (o[5] <= y + 0.7 || o[4] >= y + 1.8) continue; const cx = Math.max(o[0], Math.min(x, o[1])), cz = Math.max(o[2], Math.min(z, o[3])); if (Math.hypot(x - cx, z - cz) < r) return true; } return false; };
const groundAt = (x, z, y) => { let g = 0; for (const o of MAPB) if (o[5] <= y + 0.7 && o[5] > g && x > o[0] - 0.35 && x < o[1] + 0.35 && z > o[2] - 0.35 && z < o[3] + 0.35) g = o[5]; return g; };
const zoneR = t => t < 20 ? 70 : Math.max(12, 70 - (t - 20) * 0.35);
let nextId = 1; const rooms = new Map(), open = { duel: null, br: null };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream', '.obj': 'text/plain', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain' };
const PUB = path.join(__dirname, 'public');

// ---------- accounts (username + PIN), stored in DATA_DIR/accounts.json ----------
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data'), AF = path.join(DATA, 'accounts.json');
let ACC = {}; try { ACC = JSON.parse(fs.readFileSync(AF, 'utf8')); } catch (e) { ACC = {}; }
let dirty = false;
function flush() { if (!dirty) return; dirty = false; try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(AF + '.tmp', JSON.stringify(ACC)); fs.renameSync(AF + '.tmp', AF); } catch (e) { console.error('save failed', e.message); } }
setInterval(flush, 5000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flush(); process.exit(0); });
const sessions = new Map(), fails = new Map();
const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const defData = () => ({ xp: 0, k: 0, d: 0, w: 0, m: 0, hs: 0, bs: 0, coins: 0, heroes: [1, 0, 0, 0, 0], perks: {}, up: {}, set: { hero: 0, wi: 0, dif: 1, aim: 1, sens: 1, q: null, th: 0 } });
function fixData(d) { const b = defData(); d = Object.assign(b, d || {}); d.set = Object.assign(defData().set, d.set || {}); d.heroes = [0, 1, 2, 3, 4].map(i => (d.heroes && d.heroes[i]) || (i === 0 ? 1 : 0)); d.perks = d.perks || {}; d.up = d.up || {}; return d; }
for (const k in ACC) ACC[k].data = fixData(ACC[k].data);
function cleanSet(inSet, data) {
  const s = inSet || {}, n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(+v) ? +v : 0)));
  let hero = n(s.hero, 0, 4); if (!data.heroes[hero]) hero = 0;
  return { hero, wi: n(s.wi, 0, 4), dif: n(s.dif, 0, 2), aim: s.aim ? 1 : 0, sens: Math.max(0.4, Math.min(2, +s.sens || 1)), q: s.q == null ? null : (s.q ? 1 : 0), th: n(s.th, 0, 2) };
}
function award(acc, k, hs, d, win, bs) {
  const D = acc.data, xp = k * 10 + hs * 5 + (win ? 50 : 10), coins = coinsFor(k, hs, win, D.perks.bounty), l0 = lvlOf(D.xp);
  D.xp += xp; D.coins += coins; D.k += k; D.d += d; D.hs += hs; D.m += 1; if (win) D.w += 1; D.bs = Math.max(D.bs, Math.min(bs | 0, 100)); dirty = true;
  return { xp, coins, lv: lvlOf(D.xp) > l0 };
}
function jsonRes(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); res.end(JSON.stringify(obj)); }
function readBody(req, cb) { let d = ''; req.on('data', c => { d += c; if (d.length > 8192) req.destroy(); }); req.on('end', () => { try { cb(JSON.parse(d || '{}')); } catch (e) { cb(null); } }); }
function api(req, res, u) {
  if (req.method === 'OPTIONS') return jsonRes(res, 204, {});
  if (u === '/api/top' && req.method === 'GET') return jsonRes(res, 200, { top: Object.values(ACC).map(a => ({ name: a.name, xp: a.data.xp, k: a.data.k, w: a.data.w })).sort((a, b) => b.xp - a.xp).slice(0, 10) });
  if (u === '/api/me' && req.method === 'GET') {
    const tk = new URL(req.url, 'http://x').searchParams.get('token'), se = sessions.get(tk);
    if (!se || se.exp < Date.now() || !ACC[se.key]) return jsonRes(res, 200, { ok: false });
    return jsonRes(res, 200, { ok: true, name: ACC[se.key].name, profile: ACC[se.key].data });
  }
  if (u === '/api/auth' && req.method === 'POST') return readBody(req, b => {
    if (!b) return jsonRes(res, 400, { ok: false, err: 'Bad request' });
    const name = String(b.name || '').trim(), pin = String(b.pin || '');
    if (!/^[A-Za-z0-9_\- ]{3,14}$/.test(name)) return jsonRes(res, 200, { ok: false, err: 'Username: 3-14 letters, numbers, space, _ or -' });
    if (!/^\d{4,8}$/.test(pin)) return jsonRes(res, 200, { ok: false, err: 'PIN: 4 to 8 digits' });
    const key = name.toLowerCase(), f = fails.get(key), now = Date.now();
    if (f && f.until > now) return jsonRes(res, 200, { ok: false, err: 'Too many wrong PINs, try again in a few minutes' });
    let a = ACC[key], created = false;
    if (!a) { const salt = crypto.randomBytes(12).toString('hex'); a = ACC[key] = { name, salt, h: hashPin(pin, salt), created: now, data: defData() }; created = true; dirty = true; }
    else {
      const ok = crypto.timingSafeEqual(Buffer.from(hashPin(pin, a.salt), 'hex'), Buffer.from(a.h, 'hex'));
      if (!ok) { const n = (f && !(f.until && f.until < now) ? f.n : 0) + 1; fails.set(key, { n, until: n >= 5 ? now + 600000 : 0 }); return jsonRes(res, 200, { ok: false, err: 'Wrong PIN' }); }
      fails.delete(key);
    }
    const token = crypto.randomBytes(24).toString('hex'); sessions.set(token, { key, exp: now + 30 * 86400000 });
    jsonRes(res, 200, { ok: true, token, name: a.name, profile: a.data, created });
  });
  const authed = (b) => { const se = b && sessions.get(b.token); return se && se.exp > Date.now() && ACC[se.key] ? ACC[se.key] : null; };
  if (u === '/api/save' && req.method === 'POST') return readBody(req, b => {
    const a = authed(b); if (!a) return jsonRes(res, 401, { ok: false });
    a.data.set = cleanSet(b.data && b.data.set, a.data); dirty = true; jsonRes(res, 200, { ok: true, profile: a.data });
  });
  if (u === '/api/buy' && req.method === 'POST') return readBody(req, b => {
    const a = authed(b); if (!a) return jsonRes(res, 401, { ok: false });
    const err = applyBuy(a.data, b.item); if (err) return jsonRes(res, 200, { ok: false, err, profile: a.data });
    dirty = true; jsonRes(res, 200, { ok: true, profile: a.data });
  });
  if (u === '/api/result' && req.method === 'POST') return readBody(req, b => {
    const a = authed(b); if (!a) return jsonRes(res, 401, { ok: false });
    const goal = GOALS[b.mode], now = Date.now(); if (!goal) return jsonRes(res, 200, { ok: false, err: 'Bad mode' });
    if (a.lastRes && now - a.lastRes < 40000) return jsonRes(res, 200, { ok: false, err: 'Too soon', profile: a.data });
    const k = Math.max(0, Math.min(goal + 2, b.k | 0)), hs = Math.max(0, Math.min(k, b.hs | 0)), d = Math.max(0, Math.min(60, b.d | 0));
    a.lastRes = now; const r = award(a, k, hs, d, !!b.win && k >= 3, b.bs);
    jsonRes(res, 200, { ok: true, profile: a.data, xp: r.xp, coins: r.coins, lv: r.lv });
  });
  jsonRes(res, 404, { ok: false });
}
setInterval(() => { const now = Date.now(); for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k); }, 3600000);
const server = http.createServer((req, res) => {
  let u; try { u = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end('bad request'); }
  if (u === '/health') { res.writeHead(200); return res.end('ok'); }
  if (u.startsWith('/api/')) return api(req, res, u);
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const send = (p, o) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); };
const bcast = (r, o, except) => { for (const p of r.players.values()) if (p !== except) send(p, o); };
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? +v : 0));

function newRoom(mode, code) {
  const r = { id: nextId++, mode, cap: mode === 'br' ? 8 : 2, code, players: new Map(), started: false, over: false, t0: 0, timer: null, lt: null, zi: null, startAt: 0 };
  rooms.set(r.id, r); return r;
}
function farthest(placed) {
  let best = SP[0], bd = -1;
  for (const s of SP) { let m = 1e9; for (const q of placed) m = Math.min(m, Math.hypot(q[0] - s[0], q[1] - s[1])); if (m > bd) { bd = m; best = s; } }
  return best;
}
function spawnPick(r, self) {
  const others = [...r.players.values()].filter(p => p !== self && !p.dead).map(p => [p.x, p.z]);
  return others.length ? farthest(others) : SP[Math.floor(Math.random() * SP.length)];
}
function join(p, mode, code) {
  leave(p); let r;
  if (code && mode === 'duel') r = [...rooms.values()].find(x => x.code === code && !x.started && x.players.size < x.cap) || newRoom('duel', code);
  else { r = open[mode]; if (!r || r.started || r.players.size >= r.cap) r = open[mode] = newRoom(mode); }
  p.room = r; r.players.set(p.id, p); lobby(r);
}
function lobby(r) {
  const n = r.players.size;
  if (n >= r.cap) return start(r);
  if (r.mode === 'br' && n >= 2 && !r.timer) {
    r.startAt = Date.now() + 15000; r.timer = setTimeout(() => start(r), 15000);
    r.lt = setInterval(() => { if (!r.started) bcast(r, { t: 'wait', n: r.players.size, cap: r.cap, in: Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) }); }, 1000);
  }
  bcast(r, { t: 'wait', n, cap: r.cap, in: r.timer ? Math.max(0, Math.ceil((r.startAt - Date.now()) / 1000)) : undefined });
}
function start(r) {
  if (r.started) return;
  clearTimeout(r.timer); clearInterval(r.lt); r.pk = PKD.map(() => true); r.started = true; if (open[r.mode] === r) open[r.mode] = null; r.t0 = Date.now();
  const placed = [];
  for (const p of r.players.values()) {
    const s = placed.length ? farthest(placed) : SP[Math.floor(Math.random() * SP.length)]; placed.push(s);
    Object.assign(p, { x: s[0], y: 0, z: s[1], hp: 100, kills: 0, dead: false, heals: 2, prot: Date.now() + 3000, nextHit: 0, armor: Math.min(100, (p.ab === 3 ? 25 : 0) + (p.perks.armor ? 30 : 0)), gn: p.perks.gren ? 3 : 2, gp: 0, rk: 0, lastR: 0, acd: 0, lastN: 0, oc: 0, hsK: 0, deaths: 0, lu: 0 });
  }
  const list = [...r.players.values()].map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
  for (const p of r.players.values()) send(p, { t: 'go', you: p.id, mode: r.mode, goal: GOAL, players: list, ar: p.armor });
  if (r.mode === 'br') r.zi = setInterval(() => zoneTick(r), 1000);
}
function zoneTick(r) {
  if (r.over) return;
  const zr = zoneR((Date.now() - r.t0) / 1000), now = Date.now();
  for (const p of [...r.players.values()]) {
    if (p.dead || now < p.prot || Math.hypot(p.x, p.z) <= zr) continue;
    p.hp -= 4;
    if (p.hp <= 0) die(r, null, p, 0); else { send(p, { t: 'hp', hp: p.hp, ar: Math.round(p.armor), from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: p.hp }, p); }
  }
}
function hurtP(r, k, t, dmg, hd) {
  const a = Math.min(t.armor, dmg * 0.7); t.armor -= a; t.hp -= dmg - a;
  if (t.hp <= 0) die(r, k, t, hd);
  else { send(t, { t: 'hp', hp: Math.round(t.hp), ar: Math.round(t.armor), from: k ? k.id : 0 }); bcast(r, { t: 'oh', id: t.id, hp: Math.round(t.hp) }, t); }
}
function die(r, k, v, hd) {
  v.dead = true; v.hp = 0; v.deaths = (v.deaths || 0) + 1; if (k) { k.kills++; if (hd) k.hsK = (k.hsK || 0) + 1; }
  bcast(r, { t: 'k', k: k ? k.id : -1, v: v.id, hd: hd ? 1 : 0 });
  bcast(r, { t: 'sc', s: [...r.players.values()].map(p => [p.id, p.kills]) });
  if (k && k.kills >= GOAL) return endRoom(r, k.id);
  setTimeout(() => {
    if (r.over || !r.players.has(v.id)) return;
    const s = spawnPick(r, v); v.x = s[0]; v.z = s[1]; v.y = 0; v.hp = 100; v.dead = false; v.heals = 2; v.prot = Date.now() + 3000; v.armor = Math.min(100, (v.ab === 3 ? 25 : 0) + (v.perks.armor ? 30 : 0)); v.gn = v.perks.gren ? 3 : 2; v.gp = 0; v.rk = 0; v.lu = 0;
    send(v, { t: 'rs', x: s[0], z: s[1], ar: v.armor }); bcast(r, { t: 'ro', id: v.id, x: s[0], z: s[1] }, v);
  }, 3000);
}
function endRoom(r, winner) {
  if (r.over) return; r.over = true; clearInterval(r.zi); clearTimeout(r.timer); clearInterval(r.lt);
  bcast(r, { t: 'end', w: winner });
  for (const p of r.players.values()) if (p.acc) { const rw = award(p.acc, p.kills | 0, p.hsK | 0, p.deaths | 0, p.id === winner, 0); send(p, { t: 'rew', xp: rw.xp, coins: rw.coins, lv: rw.lv, profile: p.acc.data }); }
  setTimeout(() => { for (const p of r.players.values()) p.room = null; rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; }, 8000);
}
function leave(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p.id); p.room = null;
  if (!r.started) {
    if (r.players.size === 0) { clearTimeout(r.timer); clearInterval(r.lt); rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; return; }
    if (r.mode === 'br' && r.players.size < 2) { clearTimeout(r.timer); clearInterval(r.lt); r.timer = null; r.lt = null; }
    return lobby(r);
  }
  bcast(r, { t: 'l', id: p.id });
  if (r.mode === 'duel' && !r.over) { const o = [...r.players.values()][0]; if (o) endRoom(r, o.id); }
  if (r.players.size === 0) { clearInterval(r.zi); rooms.delete(r.id); if (open[r.mode] === r) open[r.mode] = null; }
}

wss.on('connection', ws => {
  const p = { id: nextId++, ws, name: 'Player', room: null, msgs: 0, lastG: 0 };
  ws.p = p; ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {}); ws.on('close', () => leave(p));
  ws.on('message', raw => {
    if (++p.msgs > 150) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const r = p.room, live = r && r.started && !r.over;
    switch (m.t) {
      case 'q': {
        const mode = m.mode === 'br' ? 'br' : 'duel';
        const se = sessions.get(String(m.tok || '')), ac = se && se.exp > Date.now() ? ACC[se.key] : null;
        p.acc = ac || null; p.perks = ac ? ac.data.perks : {}; p.up = ac ? ac.data.up : {};
        p.ab = Math.max(0, Math.min(4, m.ab | 0)); if (!ac || !ac.data.heroes[p.ab]) p.ab = 0;
        p.name = ac ? ac.name : (String(m.name || 'Player').replace(/[^\w \-]/g, '').slice(0, 14) || 'Player');
        join(p, mode, String(m.code || '').replace(/[^\w\-]/g, '').slice(0, 12)); break;
      }
      case 'u': if (live && !p.dead) {
        const now = Date.now(), dt = p.lu ? Math.max(0.02, (now - p.lu) / 1000) : 1;
        const x = num(m.x, -44, 44), y = num(m.y, 0, 15), z = num(m.z, -44, 44); let bad = false;
        if (MAPB.length && MOVE_CHECK) {
          const d = Math.hypot(x - p.x, z - p.z); bad = d > 45 * dt + 1.5 || y > groundAt(x, z, 0) + 3.4 && y > p.y + 4 * dt + 1.5;
          const n = Math.ceil(d / 0.4); for (let i = 1; i <= n && !bad; i++) { const t = i / n; if (solidAt(p.x + (x - p.x) * t, p.z + (z - p.z) * t, p.y + (y - p.y) * t, 0.3)) bad = true; }
        }
        p.lu = now;
        if (bad) { p.viol = (p.viol || 0) + 1; send(p, { t: 'cp', x: p.x, y: p.y, z: p.z }); break; }
        p.x = x; p.y = y; p.z = z;
        bcast(r, { t: 's', id: p.id, x: p.x, y: p.y, z: p.z, w: num(m.w, -20, 20), p: num(m.p, -2, 2), s: Math.max(0, Math.min(2, m.s | 0)) }, p);
      } break;
      case 'f': if (live && !p.dead) bcast(r, { t: 'f', id: p.id }, p); break;
      case 'h': {
        if (!live || p.dead) break;
        const t = r.players.get(m.id), W = WEAP[m.wp], now = Date.now();
        if (!t || t === p || t.dead || !W || now < p.nextHit || now < t.prot) break;
        const dist = Math.hypot(p.x - t.x, p.z - t.z); if (dist > 130) break;
        const oc = p.oc > now; p.nextHit = now + W.r * 0.8 / (oc ? 1.4 : 1);
        const hd = m.hd ? 1 : 0, n = W.pel ? Math.max(1, Math.min(W.pel, m.n | 0)) : 1, ul = (p.up[m.wp] || [0, 0, 0])[0] | 0;
        const um = 1 + [0, 0.08, 0.16, 0.25][ul], hm = p.perks.head ? 2.6 : 2.2;
        const dmg = Math.round(W.d * n * um * (oc ? 1.25 : 1) * (W.pel ? Math.max(0.3, 1 - dist / 25) : (hd ? hm : 1)));
        hurtP(r, p, t, dmg, hd);
      } break;
      case 'm': if (live && !p.dead && p.heals > 0 && p.hp < 100) {
        p.heals--; p.hp = Math.min(100, p.hp + (p.ab === 2 ? 65 : 50)); send(p, { t: 'hp', hp: p.hp, ar: Math.round(p.armor), from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: p.hp }, p);
      } break;
      case 'a': if (live && !p.dead) {
        const now = Date.now(); if (now < p.acd) break;
        if (m.k === 'aura' && p.ab === 2) { p.acd = now + CD[2] * 900; p.hp = Math.min(100, p.hp + 45); }
        else if (m.k === 'barrier' && p.ab === 3) { p.acd = now + CD[3] * 900; p.armor = Math.min(100, p.armor + 60); }
        else if (m.k === 'over' && p.ab === 4) { p.acd = now + CD[4] * 900; p.oc = now + 6000; }
        else break;
        send(p, { t: 'hp', hp: Math.round(p.hp), ar: Math.round(p.armor), from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: Math.round(p.hp) }, p);
      } break;
      case 'n': if (live && !p.dead) {
        const now = Date.now();
        if (m.r) { if (now - p.lastR < 1500) break; p.lastR = now; p.rk++; }
        else { if (p.gn <= 0 || now - p.lastN <= 600) break; p.lastN = now; p.gn--; p.gp++; }
        bcast(r, { t: 'n', id: p.id, r: m.r ? 1 : 0, x: num(m.x, -60, 60), y: num(m.y, 0, 20), z: num(m.z, -60, 60), vx: num(m.vx, -40, 40), vy: num(m.vy, -40, 40), vz: num(m.vz, -40, 40) }, p);
      } break;
      case 'x': if (live && !p.dead) {
        const rk = m.r ? 1 : 0; if (rk ? p.rk <= 0 : p.gp <= 0) break;
        if (rk) p.rk--; else p.gp--;
        const x = num(m.x, -50, 50), y = num(m.y, 0, 20), z = num(m.z, -50, 50); if (Math.hypot(x - p.x, z - p.z) > (rk ? 100 : 60)) break;
        const R = rk ? 6.5 : 7, DM = (rk ? 115 * (1 + [0, 0.08, 0.16, 0.25][(p.up.rl || [0])[0] | 0]) : 75) * (p.oc > Date.now() ? 1.25 : 1); bcast(r, { t: 'x', x, y, z }, p); const now = Date.now();
        for (const t of [...r.players.values()]) { if (t === p || t.dead || now < t.prot) continue; const d = Math.hypot(t.x - x, t.y + 1.2 - y, t.z - z); if (d < R) hurtP(r, p, t, Math.round(DM * (1 - d / R)), 0); }
      } break;
      case 'p': if (live && !p.dead) {
        const i = m.i | 0, k = PKD[i]; if (!k || !r.pk[i] || Math.hypot(p.x - k[0], p.z - k[1]) > 3.5) break;
        if ((k[2] === 'h' && p.hp >= 100) || (k[2] === 'a' && p.armor >= 100)) break;
        r.pk[i] = false;
        const sc = p.perks.scav ? 1.5 : 1; if (k[2] === 'h') p.hp = Math.min(100, p.hp + 40 * sc); else if (k[2] === 'a') p.armor = Math.min(100, p.armor + 40 * sc); else p.gn = Math.min(3, p.gn + 1);
        send(p, { t: 'hp', hp: Math.round(p.hp), ar: Math.round(p.armor), from: 0 }); bcast(r, { t: 'oh', id: p.id, hp: Math.round(p.hp) }, p); bcast(r, { t: 'pk', i, by: p.id });
        setTimeout(() => { if (!r.over && rooms.has(r.id)) { r.pk[i] = true; bcast(r, { t: 'pr', i }); } }, 25000);
      } break;
      case 'g': if (live && !p.dead && Date.now() - p.lastG > 2500) {
        p.lastG = Date.now(); bcast(r, { t: 'g', x: num(m.x, -44, 44), z: num(m.z, -44, 44), w: num(m.w, .4, 3.6), d: num(m.d, .4, 3.6) }, p);
      } break;
    }
  });
});
const resetT = setInterval(() => { for (const c of wss.clients) if (c.p) c.p.msgs = 0; }, 1000);
const hb = setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; c.ping(); } }, 30000);
wss.on('close', () => { clearInterval(hb); clearInterval(resetT); });
server.listen(PORT, () => console.log('Neon Arena server on port ' + PORT));
