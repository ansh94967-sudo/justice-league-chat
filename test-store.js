/* Unit tests for the message store: persistence + the 3-day retention window.
   Run with:  node test-store.js   */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS — ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL — ' + name + '  →  ' + e.message);
  }
}

/** Load a clean copy of the store module pointed at a temp directory. */
function freshStore(dir, days) {
  process.env.DATA_DIR = dir;
  if (days !== undefined) process.env.HISTORY_DAYS = String(days);
  delete require.cache[require.resolve('./store')];
  return require('./store');
}

const DAY = 24 * 60 * 60 * 1000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jl-store-'));

/* ---------- fresh start ---------- */
const dir1 = path.join(tmp, 'a');
let store = freshStore(dir1, 3);
store.init();
check('starts empty when no file exists', () => assert.strictEqual(store.total(), 0));
check('history window defaults to the configured days', () => assert.strictEqual(store.HISTORY_DAYS, 3));

/* ---------- writes + prune ---------- */
const now = Date.now();
store.pushRoom('hall-of-justice', { id: 'm1', from: 'brucewayne', text: 'recent', ts: now - 60 * 1000 });
store.pushRoom('hall-of-justice', { id: 'm2', from: 'brucewayne', text: 'yesterday', ts: now - DAY });
store.pushRoom('hall-of-justice', { id: 'm3', from: 'clark', text: 'two days', ts: now - 2 * DAY });
store.pushRoom('hall-of-justice', { id: 'm4', from: 'clark', text: 'four days (too old)', ts: now - 4 * DAY });
store.pushDm('bruce\u0000clark', { id: 'd1', from: 'brucewayne', text: 'private', ts: now - 3 * DAY - 1000 });

check('all five messages are in memory before pruning', () => assert.strictEqual(store.total(), 5));
const removed = store.prune();
check('prune drops only what is past the window', () => assert.strictEqual(removed, 2));
check('three recent messages survive', () => assert.strictEqual(store.total(), 3));
check('4-day-old message is gone', () =>
  assert.ok(!store.roomMessages('hall-of-justice').some(m => m.id === 'm4')));
check('DM just past 3 days is gone', () => assert.strictEqual(store.dmMessages('bruce\u0000clark').length, 0));

/* ---------- boundary: exactly inside the window is kept ---------- */
store.pushRoom('boundary', { id: 'b1', from: 'x_y_z', text: 'edge', ts: Date.now() - 3 * DAY + 5000 });
store.prune();
check('message just inside the window is kept', () =>
  assert.strictEqual(store.roomMessages('boundary').length, 1));

/* ---------- channels are persisted too ---------- */
store.addRoom({ id: 'star-labs', name: 'Star Labs', desc: 'Opened by brucewayne' });
check('custom channel registered', () => assert.strictEqual(store.hasRoom('star-labs'), true));

/* ---------- save → reload (simulating a server restart) ---------- */
store.saveNow();
check('history file written', () => assert.ok(fs.existsSync(path.join(dir1, 'history.json'))));
check('no leftover temp file', () => assert.ok(!fs.existsSync(path.join(dir1, 'history.json.tmp'))));

const reloaded = freshStore(dir1, 3);
reloaded.init();
check('messages survive a restart', () => assert.strictEqual(reloaded.total(), 4));
check('channel list survives a restart', () => assert.strictEqual(reloaded.hasRoom('star-labs'), true));
check('message content survives intact', () => {
  const m = reloaded.roomMessages('hall-of-justice').find(x => x.id === 'm2');
  assert.strictEqual(m.text, 'yesterday');
  assert.strictEqual(m.from, 'brucewayne');
});

/* ---------- old messages are dropped on load ---------- */
const dir2 = path.join(tmp, 'b');
fs.mkdirSync(dir2, { recursive: true });
fs.writeFileSync(path.join(dir2, 'history.json'), JSON.stringify({
  historyDays: 3,
  rooms: [],
  roomHistory: {
    'hall-of-justice': [
      { id: 'old', from: 'a_b_c', text: 'ancient', ts: Date.now() - 5 * DAY },
      { id: 'new', from: 'a_b_c', text: 'fresh', ts: Date.now() - 60 * 1000 }
    ]
  },
  dmHistory: {}
}));
const loaded = freshStore(dir2, 3);
loaded.init();
check('stale history is pruned at load time', () => assert.strictEqual(loaded.total(), 1));
check('the fresh message is the survivor', () =>
  assert.strictEqual(loaded.roomMessages('hall-of-justice')[0].text, 'fresh'));

/* ---------- a longer window keeps more ---------- */
const dir3 = path.join(tmp, 'c');
fs.mkdirSync(dir3, { recursive: true });
fs.writeFileSync(path.join(dir3, 'history.json'), JSON.stringify({
  rooms: [], roomHistory: {
    r: [
      { id: 'a', from: 'x_y_z', text: 'two days old', ts: Date.now() - 2 * DAY },
      { id: 'b', from: 'x_y_z', text: 'nine days old', ts: Date.now() - 9 * DAY }
    ]
  }, dmHistory: {}
}));
const weekStore = freshStore(dir3, 10);
weekStore.init();
check('HISTORY_DAYS is configurable (10-day window keeps 2-day-old)', () =>
  assert.strictEqual(weekStore.total(), 2));

/* ---------- corrupt file does not crash ---------- */
const dir4 = path.join(tmp, 'd');
fs.mkdirSync(dir4, { recursive: true });
fs.writeFileSync(path.join(dir4, 'history.json'), '{ this is not json');
const survivor = freshStore(dir4, 3);
survivor.init();
check('a corrupt history file is ignored, not fatal', () => assert.strictEqual(survivor.total(), 0));

/* cleanup */
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + (failures === 0 ? 'ALL STORE TESTS PASSED' : failures + ' STORE TEST(S) FAILED'));
process.exit(failures === 0 ? 0 : 1);
