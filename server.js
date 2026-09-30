/**
 * Justice League Chat — server
 * Express + Socket.IO real-time chat featuring:
 *  - Site password gate + hero-name identity creation
 *  - Group channels (themed defaults + user-created)
 *  - Direct (1:1) messages
 *  - Emoji reactions, own-message deletion
 *  - Per-channel presence, typing indicators, join/leave system messages
 *  - Spam-proof token-bucket rate limiting
 *  - Reconnect-safe sessions (token renewed on every connection)
 */
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'watchtower';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6, pingInterval: 20000, pingTimeout: 25000 });

app.use(express.json());
// no long cache: browsers revalidate with ETag, so deploys show up immediately
app.use(express.static(path.join(__dirname, 'public'), { etag: true, maxAge: 0 }));

/* ------------------------------------------------------------------ */
/* Heroes                                                              */
/* ------------------------------------------------------------------ */
const HEROES = [
  { id: 'superman',          name: 'Superman',          emoji: '🦸',   color: '#d6273e' },
  { id: 'supergirl',         name: 'Supergirl',         emoji: '🦸‍♀️', color: '#e8598f' },
  { id: 'batman',            name: 'Batman',            emoji: '🦇',   color: '#7c8db5' },
  { id: 'nightwing',         name: 'Nightwing',        emoji: '🪶',   color: '#4f7cd6' },
  { id: 'wonder-woman',      name: 'Wonder Woman',      emoji: '⚔️',   color: '#e3b341' },
  { id: 'flash',             name: 'The Flash',         emoji: '⚡',   color: '#f0772c' },
  { id: 'aquaman',           name: 'Aquaman',           emoji: '🔱',   color: '#2fa3c4' },
  { id: 'mera',              name: 'Mera',              emoji: '🌊',   color: '#3fb6a8' },
  { id: 'cyborg',            name: 'Cyborg',            emoji: '🤖',   color: '#9d7bf7' },
  { id: 'green-lantern',     name: 'Green Lantern',     emoji: '💚',   color: '#3ddc84' },
  { id: 'martian-manhunter', name: 'Martian Manhunter', emoji: '👽',   color: '#4ade80' },
  { id: 'firestorm',         name: 'Firestorm',         emoji: '🔥',   color: '#ff7847' },
  { id: 'shazam',            name: 'Shazam',           emoji: '🌩️',   color: '#ef4444' },
  { id: 'green-arrow',       name: 'Green Arrow',       emoji: '🏹',   color: '#a3ce3e' },
  { id: 'hawkgirl',          name: 'Hawkgirl',          emoji: '🦅',   color: '#d9914a' },
  { id: 'zatanna',           name: 'Zatanna',           emoji: '🎩',   color: '#c084fc' }
];
const HERO_IDS = new Set(HEROES.map(h => h.id));

const REACTIONS = ['⚡', '💥', '🛡️', '❤️', '😂', '👍'];
const MAX_TEXT = 500;
const HISTORY_LIMIT = 300;

/* ------------------------------------------------------------------ */
/* State (in-memory)                                                   */
/* ------------------------------------------------------------------ */
const sessions = new Map();      // token -> { username, hero }
const online = new Map();        // username -> { hero, sockets: Set<socketId> }

const DEFAULT_ROOMS = [
  { id: 'hall-of-justice', name: 'Hall of Justice',  desc: 'General assembly for the entire League' },
  { id: 'watchtower',      name: 'Watchtower Ops',   desc: 'Mission coordination and alerts' },
  { id: 'metropolis',      name: 'Metropolis',       desc: 'City watch — Man of Steel turf' },
  { id: 'gotham',          name: 'Gotham',          desc: 'After-dark patrol channel' },
  { id: 'atlantis',        name: 'Atlantis',         desc: 'Deep-sea comms with the Throne' }
];
const rooms = new Map(DEFAULT_ROOMS.map(r => [r.id, { ...r }]));

const roomHistory = new Map();   // roomId -> [msg]
const dmHistory = new Map();     // pairKey -> [msg]
const roomMembers = new Map();   // roomId -> Set<username>

const pairKey = (a, b) => [a, b].sort().join('\u0000');
const cleanText = t => String(t || '').trim().slice(0, MAX_TEXT);
const uid = () => crypto.randomUUID();

/* --- token-bucket rate limiter: burst of 10, refills 1/sec --- */
const buckets = new Map();       // username -> { tokens, last }
function allowMessage(username) {
  const now = Date.now();
  let b = buckets.get(username);
  if (!b) { b = { tokens: 10, last: now }; buckets.set(username, b); }
  b.tokens = Math.min(10, b.tokens + (now - b.last) / 1000);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function pushHistory(map, key, msg) {
  if (!map.has(key)) map.set(key, []);
  const list = map.get(key);
  list.push(msg);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}
function systemMessage(text) {
  return { id: uid(), system: true, text, ts: Date.now() };
}

/* ------------------------------------------------------------------ */
/* REST endpoints                                                      */
/* ------------------------------------------------------------------ */
app.get('/api/heroes', (_req, res) => res.json({ heroes: HEROES }));

app.get('/api/config', (_req, res) =>
  res.json({ siteName: 'Justice League Chat', hasCustomPassword: process.env.SITE_PASSWORD !== undefined }));

app.post('/api/verify-password', (req, res) => {
  const { password } = req.body || {};
  if (password !== SITE_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Access denied. The Watchtower remains sealed.' });
  }
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { password, username, hero } = req.body || {};
  if (password !== SITE_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Access denied. The Watchtower remains sealed.' });
  }
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
    return res.status(400).json({ ok: false, error: 'Hero name must be 3–20 characters (letters, numbers, underscore).' });
  }
  if (!HERO_IDS.has(hero)) {
    return res.status(400).json({ ok: false, error: 'Unknown hero. Pick from the roster.' });
  }
  if (online.has(name)) {
    return res.status(409).json({ ok: false, error: 'That hero name is already active in the Hall. Choose another.' });
  }
  const token = uid();
  sessions.set(token, { username: name, hero });
  res.json({ ok: true, token, username: name, hero });
});

app.post('/api/session', (req, res) => {
  const { token } = req.body || {};
  const s = token && sessions.get(token);
  if (!s) return res.status(401).json({ ok: false, error: 'session-expired' });
  if (online.has(s.username)) {
    return res.status(409).json({ ok: false, error: 'Your hero is already connected in another tab or window.' });
  }
  res.json({ ok: true, username: s.username, hero: s.hero });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, heroes: online.size }));

/* ------------------------------------------------------------------ */
/* Socket.IO                                                           */
/* ------------------------------------------------------------------ */
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const s = token && sessions.get(token);
  if (!s) return next(new Error('unauthorized'));

  // rotate the session token so the same token is never reused
  sessions.delete(token);
  const renewed = uid();
  sessions.set(renewed, { username: s.username, hero: s.hero });
  socket.data.username = s.username;
  socket.data.hero = s.hero;
  socket.data.renewedToken = renewed;
  next();
});

function presenceList() {
  return [...online.values()].map(u => ({ username: u.username, hero: u.hero }));
}
function broadcastPresence() {
  io.emit('presence', { users: presenceList() });
}
function roomList() {
  return [...rooms.values()].map(r => ({ id: r.id, name: r.name, desc: r.desc }));
}
function membersOf(roomId) {
  return [...(roomMembers.get(roomId) || [])].map(username => {
    const u = online.get(username);
    return { username, hero: u ? u.hero : null };
  });
}
function broadcastRoomPresence(roomId) {
  io.to('room:' + roomId).emit('room:presence', { roomId, users: membersOf(roomId) });
}

io.on('connection', socket => {
  const { username, hero } = socket.data;

  /* register + announce */
  if (!online.has(username)) {
    online.set(username, { username, hero, sockets: new Set() });
    broadcastPresence();
    // a hero entering/leaving the Watchtower is announced in the Hall
    const sys = systemMessage(`⚡ ${username} has entered the Hall of Justice`);
    pushHistory(roomHistory, 'hall-of-justice', sys);
    io.to('room:hall-of-justice').emit('room:message', { roomId: 'hall-of-justice', message: sys });
  } else {
    broadcastPresence();
  }
  online.get(username).sockets.add(socket.id);
  socket.emit('session:renewed', { token: socket.data.renewedToken });
  io.emit('rooms', { rooms: roomList() });

  socket.on('disconnect', () => {
    const u = online.get(username);
    if (!u) return;
    u.sockets.delete(socket.id);
    if (u.sockets.size === 0) {
      online.delete(username);
      buckets.delete(username);
      for (const [roomId, set] of roomMembers) {
        if (set.delete(username)) broadcastRoomPresence(roomId);
      }
      broadcastPresence();
      const sys = systemMessage(`🌑 ${username} has left the Hall of Justice`);
      pushHistory(roomHistory, 'hall-of-justice', sys);
      io.to('room:hall-of-justice').emit('room:message', { roomId: 'hall-of-justice', message: sys });
    }
  });

  /* ------------------ group channels ------------------ */
  socket.on('room:join', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error:msg', { text: 'That channel does not exist.' });
    socket.join('room:' + roomId);
    if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
    roomMembers.get(roomId).add(username);
    socket.emit('room:history', { roomId, messages: roomHistory.get(roomId) || [] });
    broadcastRoomPresence(roomId);
  });

  socket.on('room:leave', ({ roomId } = {}) => {
    socket.leave('room:' + roomId);
    const set = roomMembers.get(roomId);
    if (set && set.delete(username)) broadcastRoomPresence(roomId);
  });

  socket.on('room:message', ({ roomId, text } = {}) => {
    const room = rooms.get(roomId);
    const body = cleanText(text);
    if (!room || !body) return;
    if (!allowMessage(username)) {
      return socket.emit('error:msg', { text: 'Easy, Speedster — you are transmitting too fast.' });
    }
    const msg = { id: uid(), from: username, hero, text: body, ts: Date.now(), reactions: {} };
    pushHistory(roomHistory, roomId, msg);
    io.to('room:' + roomId).emit('room:message', { roomId, message: msg });
  });

  socket.on('room:create', ({ name } = {}) => {
    const clean = String(name || '').trim().slice(0, 30);
    if (!clean) return;
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) return socket.emit('error:msg', { text: 'Invalid channel name.' });
    if (rooms.has(id)) return socket.emit('error:msg', { text: 'A channel with that name already exists.' });
    rooms.set(id, { id, name: clean, desc: `Opened by ${username}` });
    io.emit('rooms', { rooms: roomList() });
    socket.emit('room:created', { roomId: id });
  });

  socket.on('room:typing', ({ roomId, typing } = {}) => {
    if (!rooms.has(roomId)) return;
    socket.to('room:' + roomId).emit('room:typing', { roomId, username, typing: !!typing });
  });

  socket.on('room:react', ({ roomId, msgId, emoji } = {}) => {
    if (!REACTIONS.includes(emoji)) return;
    const list = roomHistory.get(roomId) || [];
    const msg = list.find(m => m.id === msgId);
    if (!msg || msg.system) return;
    msg.reactions = msg.reactions || {};
    const users = (msg.reactions[emoji] = msg.reactions[emoji] || []);
    const i = users.indexOf(username);
    if (i >= 0) users.splice(i, 1); else users.push(username);
    if (!users.length) delete msg.reactions[emoji];
    io.to('room:' + roomId).emit('room:reaction', { roomId, msgId, reactions: msg.reactions });
  });

  socket.on('room:delete', ({ roomId, msgId } = {}) => {
    const msg = (roomHistory.get(roomId) || []).find(m => m.id === msgId);
    if (!msg || msg.system || msg.from !== username) return;
    msg.deleted = true;
    msg.text = '';
    io.to('room:' + roomId).emit('room:delete', { roomId, msgId });
  });

  /* ------------------ direct messages ------------------ */
  socket.on('dm:open', ({ with: target } = {}) => {
    const key = pairKey(username, target);
    socket.join('dm:' + key);
    socket.emit('dm:history', { with: target, messages: dmHistory.get(key) || [] });
  });

  socket.on('dm:message', ({ to, text } = {}) => {
    const target = online.get(to);
    const body = cleanText(text);
    if (!target || to === username || !body) return;
    if (!allowMessage(username)) {
      return socket.emit('error:msg', { text: 'Easy, Speedster — you are transmitting too fast.' });
    }
    const key = pairKey(username, to);
    for (const sid of target.sockets) io.sockets.sockets.get(sid)?.join('dm:' + key);
    const msg = { id: uid(), from: username, hero, to, text: body, ts: Date.now(), reactions: {} };
    pushHistory(dmHistory, key, msg);
    io.to('dm:' + key).emit('dm:message', { message: msg });
  });

  socket.on('dm:typing', ({ with: target, typing } = {}) => {
    if (!online.has(target)) return;
    socket.to('dm:' + pairKey(username, target)).emit('dm:typing', { from: username, typing: !!typing });
  });

  socket.on('dm:react', ({ with: target, msgId, emoji } = {}) => {
    if (!REACTIONS.includes(emoji)) return;
    const key = pairKey(username, target);
    const list = dmHistory.get(key) || [];
    const msg = list.find(m => m.id === msgId);
    if (!msg || msg.system) return;
    msg.reactions = msg.reactions || {};
    const users = (msg.reactions[emoji] = msg.reactions[emoji] || []);
    const i = users.indexOf(username);
    if (i >= 0) users.splice(i, 1); else users.push(username);
    if (!users.length) delete msg.reactions[emoji];
    io.to('dm:' + key).emit('dm:reaction', { pair: key.split('\u0000'), msgId, reactions: msg.reactions });
  });

  socket.on('dm:delete', ({ with: target, msgId } = {}) => {
    const key = pairKey(username, target);
    const msg = (dmHistory.get(key) || []).find(m => m.id === msgId);
    if (!msg || msg.from !== username) return;
    msg.deleted = true;
    msg.text = '';
    io.to('dm:' + key).emit('dm:delete', { pair: key.split('\u0000'), msgId });
  });

  socket.on('error', () => { /* swallow protocol-level noise */ });
});

/* ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log(`⚡ Justice League Chat online — http://localhost:${PORT}`);
  console.log(`   SITE_PASSWORD: ${process.env.SITE_PASSWORD ? '(custom)' : 'watchtower (default)'}`);
});
