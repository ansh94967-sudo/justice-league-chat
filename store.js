/**
 * Justice League Chat — message store
 *
 * Keeps channel + direct-message history on disk so it survives restarts,
 * and enforces a retention window (default: 3 days). Messages older than the
 * window are pruned on load and every 15 minutes.
 *
 * Configuration:
 *   HISTORY_DAYS  how many days of history to keep (default 3)
 *   DATA_DIR      where history.json lives (default ./data)
 *
 * Note: the file lives on the host's disk. On hosts with an ephemeral
 * filesystem (e.g. a Render instance without a persistent disk) it survives
 * process restarts but not redeploys — attach a disk to DATA_DIR to keep it.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'history.json');
const HISTORY_DAYS = Math.max(1, Number.parseInt(process.env.HISTORY_DAYS || '3', 10) || 3);
const WINDOW_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
const MAX_PER_CONVO = 1500; // safety valve, well above a normal 3-day load

const rooms = new Map();        // id -> { id, name, desc }
const roomHistory = new Map();  // roomId -> [msg]
const dmHistory = new Map();    // pairKey -> [msg]

let saveTimer = null;
let savePending = false;

function total() {
  let n = 0;
  for (const list of roomHistory.values()) n += list.length;
  for (const list of dmHistory.values()) n += list.length;
  return n;
}

/** Drop everything older than the retention window (and any oversized backlog). */
function prune() {
  const cutoff = Date.now() - WINDOW_MS;
  let removed = 0;
  const clean = map => {
    for (const [key, list] of [...map.entries()]) {
      const fresh = list.filter(m => m.ts >= cutoff);
      const kept = fresh.length > MAX_PER_CONVO ? fresh.slice(-MAX_PER_CONVO) : fresh;
      removed += list.length - kept.length;
      if (kept.length) map.set(key, kept); else map.delete(key);
    }
  };
  clean(roomHistory);
  clean(dmHistory);
  return removed;
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const r of raw.rooms || []) if (r && r.id) rooms.set(r.id, r);
    for (const [k, list] of Object.entries(raw.roomHistory || {})) {
      if (Array.isArray(list)) roomHistory.set(k, list);
    }
    for (const [k, list] of Object.entries(raw.dmHistory || {})) {
      if (Array.isArray(list)) dmHistory.set(k, list);
    }
    const removed = prune();
    console.log(`[store] restored ${total()} messages — ${roomHistory.size} channel(s), ${dmHistory.size} DM(s)` +
      ` (${HISTORY_DAYS}-day window${removed ? `, pruned ${removed} old` : ''})`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[store] history not loaded:', e.message);
    else console.log(`[store] no history file yet — starting fresh (${HISTORY_DAYS}-day window)`);
  }
}

function snapshot() {
  return {
    savedAt: Date.now(),
    historyDays: HISTORY_DAYS,
    rooms: [...rooms.values()],
    roomHistory: Object.fromEntries(roomHistory),
    dmHistory: Object.fromEntries(dmHistory)
  };
}

/** Write immediately (atomic: temp file + rename). */
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  savePending = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snapshot()));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn('[store] save failed:', e.message);
  }
}

/** Debounced write — call after any mutation. */
function touch() {
  savePending = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (savePending) saveNow();
  }, 700);
}

function init() {
  load();
  const timer = setInterval(() => {
    const removed = prune();
    if (removed) {
      console.log(`[store] pruned ${removed} message(s) past the ${HISTORY_DAYS}-day window`);
      touch();
    }
  }, 15 * 60 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = {
  HISTORY_DAYS,
  WINDOW_MS,
  init,
  touch,
  saveNow,
  prune,
  total,
  hasPendingSave: () => savePending,

  /* ---- channels ---- */
  rooms: () => [...rooms.values()],
  hasRoom: id => rooms.has(id),
  getRoom: id => rooms.get(id),
  addRoom(room) {
    if (!room || rooms.has(room.id)) return false;
    rooms.set(room.id, room);
    touch();
    return true;
  },

  /* ---- history ---- */
  pushRoom(roomId, msg) {
    if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
    roomHistory.get(roomId).push(msg);
    touch();
  },
  pushDm(key, msg) {
    if (!dmHistory.has(key)) dmHistory.set(key, []);
    dmHistory.get(key).push(msg);
    touch();
  },
  roomMessages: roomId => roomHistory.get(roomId) || [],
  dmMessages: key => dmHistory.get(key) || [],
  findRoomMessage: (roomId, msgId) => (roomHistory.get(roomId) || []).find(m => m.id === msgId),
  findDmMessage: (key, msgId) => (dmHistory.get(key) || []).find(m => m.id === msgId)
};
