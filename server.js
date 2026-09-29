/**
 * Justice League Chat — server
 * Express + Socket.IO real-time chat with:
 *  - Site password gate (password + username creation)
 *  - Group chat rooms (default themed rooms + user-created rooms)
 *  - Direct (1:1) messages between online members
 *  - Online presence, typing indicators and in-memory history
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
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/* Heroes                                                              */
/* ------------------------------------------------------------------ */
const HEROES = [
  { id: 'superman', name: 'Superman', emoji: '\u{1F9B8}', color: '#D6273E' },
  { id: 'batman', name: 'Batman', emoji: '\u{1F987}', color: '#4A5568' },
  { id: 'wonder-woman', name: 'Wonder Woman', emoji: '\u2694\uFE0F', color: '#C9A227' },
  { id: 'flash', name: 'The Flash', emoji: '\u26A1', color: '#E8590C' },
  { id: 'aquaman', name: 'Aquaman', emoji: '\u{1F531}', color: '#1E7F9C' },
  { id: 'cyborg', name: 'Cyborg', emoji: '\u{1F916}', color: '#8B5CF6' },
  { id: 'green-lantern', name: 'Green Lantern', emoji: '\u{1F7E9}', color: '#22C55E' },
  { id: 'martian-manhunter', name: 'Martian Manhunter', emoji: '\u{1F47D}', color: '#16A34A' },
  { id: 'shazam', name: 'Shazam', emoji: '\u{1F329}\uFE0F', color: '#EF4444' },
  { id: 'green-arrow', name: 'Green Arrow', emoji: '\u{1F3F9}', color: '#65A30D' },
  { id: 'hawkgirl', name: 'Hawkgirl', emoji: '\u{1F985}', color: '#B45309' },
  { id: 'zatanna', name: 'Zatanna', emoji: '\u{1F3A9}', color: '#A855F7' }
];
const HERO_IDS = new Set(HEROES.map(h => h.id));
const heroById = id => HEROES.find(h => h.id === id);

/* ------------------------------------------------------------------ */
/* State (in-memory)                                                   */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // token -> { username, hero }
const online = new Map();   // username -> { hero, sockets: Set<socketId> }

const DEFAULT_ROOMS = [
  { id: 'hall-of-justice', name: 'Hall of Justice', desc: 'General assembly for the entire League' },
  { id: 'watchtower', name: 'Watchtower Ops', desc: 'Mission coordination and alerts' },
  { id: 'metropolis', name: 'Metropolis', desc: 'City watch — Man of Steel turf' },
  { id: 'gotham', name: 'Gotham', desc: 'After-dark patrol channel' },
  { id: 'atlantis', name: 'Atlantis', desc: 'Deep-sea comms with the Throne' }
];
const rooms = new Map(DEFAULT_ROOMS.map(r => [r.id, { ...r }]));

const roomHistory = new Map(); // roomId -> [msg]
const dmHistory = new Map();   // pairKey -> [msg]
const HISTORY_LIMIT = 200;
const MAX_TEXT = 500;

const pairKey = (a, b) => [a, b].sort().join('\u0000');
const cleanText = t => String(t || '').replace(/\s+/, ' ').trim().slice(0, MAX_TEXT);

/* ------------------------------------------------------------------ */
/* REST endpoints                                                      */
/* ------------------------------------------------------------------ */
app.get('/api/heroes', (_req, res) => res.json({ heroes: HEROES }));

// Step 1: check the site password ("The Watchtower remains sealed")
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body || {};
  if (password !== SITE_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Access denied. The Watchtower remains sealed.' });
  }
  res.json({ ok: true });
});

// Step 2: create identity (username + hero) and open a session
app.post('/api/login', (req, res) => {
  const { password, username, hero } = req.body || {};
  if (password !== SITE_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'Access denied. The Watchtower remains sealed.' });
  }
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) {
    return res.status(400).json({ ok: false, error: 'Hero name must be 3-20 characters (letters, numbers, underscore).' });
  }
  if (!HERO_IDS.has(hero)) {
    return res.status(400).json({ ok: false, error: 'Unknown hero. Pick from the roster.' });
  }
  if (online.has(name)) {
    return res.status(409).json({ ok: false, error: 'That hero name is already active in the Hall. Choose another.' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { username: name, hero });
  res.json({ ok: true, token, username: name, hero });
});

// Session check (used on page reload)
app.post('/api/session', (req, res) => {
  const { token } = req.body || {};
  const s = sessions.get(token);
  if (!s) return res.status(401).json({ ok: false });
  if (online.has(s.username)) {
    // Previous connection may be stale; keep it simple and allow reconnect.
    sessions.delete(token);
    return res.status(401).json({ ok: false, error: 'Already connected elsewhere.' });
  }
  res.json({ ok: true, username: s.username, hero: s.hero });
});

/* ------------------------------------------------------------------ */
/* Socket.IO                                                           */
/* ------------------------------------------------------------------ */
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const s = token && sessions.get(token);
  if (!s) return next(new Error('unauthorized'));
  socket.data.username = s.username;
  socket.data.hero = s.hero;
  sessions.delete(token); // one connection per session token
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
function pushHistory(map, key, msg) {
  if (!map.has(key)) map.set(key, []);
  const list = map.get(key);
  list.push(msg);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}
function joinDmRoom(sockets, a, b) {
  const key = pairKey(a, b);
  for (const s of sockets) s.join('dm:' + key);
  return key;
}

io.on('connection', socket => {
  const { username, hero } = socket.data;

  // register presence
  if (!online.has(username)) online.set(username, { username, hero, sockets: new Set() });
  online.get(username).sockets.add(socket.id);
  broadcastPresence();
  io.emit('rooms', { rooms: roomList() });

  /* ----- group rooms ----- */
  socket.on('room:join', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error:msg', { text: 'That room does not exist.' });
    socket.join('room:' + roomId);
    const history = roomHistory.get(roomId) || [];
    socket.emit('room:history', { roomId, messages: history });
  });

  socket.on('room:message', ({ roomId, text } = {}) => {
    const room = rooms.get(roomId);
    const body = cleanText(text);
    if (!room || !body) return;
    const msg = {
      id: crypto.randomUUID(), from: username, hero,
      text: body, ts: Date.now()
    };
    pushHistory(roomHistory, roomId, msg);
    io.to('room:' + roomId).emit('room:message', { roomId, message: msg });
  });

  socket.on('room:create', ({ name } = {}) => {
    const clean = String(name || '').trim().slice(0, 30);
    if (!clean) return;
    let id = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) return socket.emit('error:msg', { text: 'Invalid room name.' });
    if (rooms.has(id)) return socket.emit('error:msg', { text: 'A room with that name already exists.' });
    rooms.set(id, { id, name: clean, desc: 'Opened by ' + username });
    io.emit('rooms', { rooms: roomList() });
    socket.emit('room:created', { roomId: id });
  });

  socket.on('room:typing', ({ roomId, typing } = {}) => {
    if (!rooms.has(roomId)) return;
    socket.to('room:' + roomId).emit('room:typing', { roomId, username, typing: !!typing });
  });

  /* ----- direct messages ----- */
  socket.on('dm:open', ({ with: target } = {}) => {
    const key = pairKey(username, target);
    socket.join('dm:' + key);
    const history = dmHistory.get(key) || [];
    socket.emit('dm:history', { with: target, messages: history });
  });

  socket.on('dm:message', ({ to, text } = {}) => {
    const target = online.get(to);
    const body = cleanText(text);
    if (!target || to === username || !body) return;
    // make sure the recipient's sockets are in the DM room
    for (const sid of target.sockets) io.sockets.sockets.get(sid)?.join('dm:' + pairKey(username, to));
    const msg = { id: crypto.randomUUID(), from: username, hero, to, text: body, ts: Date.now() };
    pushHistory(dmHistory, pairKey(username, to), msg);
    io.to('dm:' + pairKey(username, to)).emit('dm:message', { message: msg });
  });

  socket.on('dm:typing', ({ with: target, typing } = {}) => {
    if (!online.has(target)) return;
    socket.to('dm:' + pairKey(username, target)).emit('dm:typing', { from: username, typing: !!typing });
  });

  /* ----- teardown ----- */
  socket.on('disconnect', () => {
    const u = online.get(username);
    if (!u) return;
    u.sockets.delete(socket.id);
    if (u.sockets.size === 0) {
      online.delete(username);
      broadcastPresence();
    }
  });
});

/* ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log(`Justice League Chat online — http://localhost:${PORT}`);
  console.log(`Site password: ${SITE_PASSWORD === 'watchtower' ? 'watchtower (default — set SITE_PASSWORD to change)' : '(custom, from SITE_PASSWORD)'}`);
});
