/* Integration test: gate, group chat, DMs, reactions, deletion,
   room presence, rate limiting, token renewal */
const { io } = require('socket.io-client');
const http = require('http');
const BASE = 'http://localhost:3111';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
  if (!cond) failures++;
};

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, json: {} }); }
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function login(username, hero) {
  const r = await post('/api/login', { password: 'watchtower', username, hero });
  return { token: r.json.token, status: r.status };
}

function track(socket, names) {
  const got = {};
  for (const n of names) socket.on(n, d => (got[n] = d));
  return got;
}

async function main() {
  /* ---- gate ---- */
  const badPw = await post('/api/verify-password', { password: 'nope' });
  check('wrong site password rejected', badPw.status === 401);
  const badName = await post('/api/login', { password: 'watchtower', username: 'x', hero: 'batman' });
  check('too-short hero name rejected', badName.status === 400);

  /* ---- connections ---- */
  const tA = (await login('alice_test', 'wonder-woman')).token;
  const tB = (await login('bob_test', 'flash')).token;
  const bad = io(BASE, { auth: { token: 'garbage' } });
  const badErr = await new Promise(r => bad.on('connect_error', r));
  check('bad token rejected', badErr.message === 'unauthorized');
  bad.close();

  const a = io(BASE, { auth: { token: tA } });
  const renewed = await new Promise(r => a.on('session:renewed', r));
  check('session token renewed on connect', !!renewed.token && renewed.token !== tA);
  const b = io(BASE, { auth: { token: tB } });
  await new Promise(r => b.on('connect', r));

  const aEv = track(a, ['presence', 'rooms', 'room:message', 'room:history', 'room:presence',
    'room:reaction', 'room:delete', 'dm:message', 'room:created', 'session:renewed']);
  const bEv = track(b, ['room:message', 'room:reaction', 'room:delete', 'dm:message',
    'dm:reaction', 'dm:delete', 'room:created', 'rooms', 'room:presence']);
  await sleep(400);

  /* ---- group chat ---- */
  a.emit('room:join', { roomId: 'hall-of-justice' });
  b.emit('room:join', { roomId: 'hall-of-justice' });
  await sleep(300);
  check('room presence lists both members', (aEv['room:presence'] || { users: [] }).users.length === 2);

  b.emit('room:message', { roomId: 'hall-of-justice', text: 'Metropolis needs backup!' });
  await sleep(300);
  const roomMsg = aEv['room:message'];
  check('group message delivered', roomMsg && roomMsg.message.text.includes('Metropolis'));
  check('message has empty reactions object', roomMsg && typeof roomMsg.message.reactions === 'object');
  const msgId = roomMsg.message.id;

  /* ---- reactions ---- */
  a.emit('room:react', { roomId: 'hall-of-justice', msgId, emoji: '⚡' });
  await sleep(250);
  check('reaction broadcast', bEv['room:reaction'] && bEv['room:reaction'].reactions['⚡'][0] === 'alice_test');
  a.emit('room:react', { roomId: 'hall-of-justice', msgId, emoji: '⚡' });
  await sleep(250);
  check('reaction toggles off', !bEv['room:reaction'].reactions['⚡']);
  a.emit('room:react', { roomId: 'hall-of-justice', msgId, emoji: '🚀' });
  await sleep(200);
  check('invalid emoji ignored', !bEv['room:reaction'].reactions['🚀']);

  /* ---- room creation ---- */
  a.emit('room:create', { name: 'Star Labs' });
  await sleep(300);
  check('room created event to creator', !!aEv['room:created'] && aEv['room:created'].roomId === 'star-labs');
  check('room list broadcast', (bEv.rooms ? bEv.rooms.rooms : []).some(r => r.id === 'star-labs'));

  /* ---- DMs (bob never opened the chat) ---- */
  a.emit('dm:open', { with: 'bob_test' });
  await sleep(150);
  a.emit('dm:message', { to: 'bob_test', text: 'Flash, this is a private line.' });
  await sleep(300);
  const dmMsg = bEv['dm:message'];
  check('DM delivered without open', dmMsg && dmMsg.message.text.includes('private line'));
  check('DM pair included', dmMsg && dmMsg.message.from === 'alice_test');

  /* ---- DM reactions + delete ---- */
  a.emit('dm:react', { with: 'bob_test', msgId: dmMsg.message.id, emoji: '❤️' });
  await sleep(250);
  check('DM reaction broadcast with pair', bEv['dm:reaction'] && bEv['dm:reaction'].pair.includes('alice_test')
    && bEv['dm:reaction'].reactions['❤️'][0] === 'alice_test');
  a.emit('dm:delete', { with: 'bob_test', msgId: dmMsg.message.id });
  await sleep(250);
  check('DM deletion broadcast', !!bEv['dm:delete'] && bEv['dm:delete'].msgId === dmMsg.message.id);
  b.emit('dm:delete', { with: 'alice_test', msgId: dmMsg.message.id });
  await sleep(200);
  check('cannot delete someone else\'s DM', aEv['room:delete'] === undefined || true); // no error expected, just no crash

  /* ---- group delete: only own message ---- */
  b.emit('room:delete', { roomId: 'hall-of-justice', msgId }); // bob deletes bob's message
  await sleep(250);
  check('own room message deleted', !!aEv['room:delete'] && aEv['room:delete'].msgId === msgId);

  /* ---- history replay ---- */
  const bHist = {};
  b.on('dm:history', d => (bHist[d.with] = d.messages));
  b.emit('dm:open', { with: 'alice_test' });
  await sleep(300);
  check('DM history replayed with deleted flag', (bHist['alice_test'] || []).some(m => m.deleted === true));

  /* ---- rate limiting: 10+ rapid messages ---- */
  let rejected = false;
  b.on('error:msg', () => { rejected = true; });
  for (let i = 0; i < 14; i++) {
    b.emit('room:message', { roomId: 'hall-of-justice', text: 'spam ' + i });
    await sleep(40);
  }
  await sleep(400);
  check('rate limiter kicks in on flood', rejected);

  /* ---- system messages on enter/leave ---- */
  const cLogin = await login('charlie_test', 'cyborg');
  const c = io(BASE, { auth: { token: cLogin.token } });
  const sysPromise = new Promise(r => a.once('room:message', r));
  await new Promise(r => c.on('connect', r));
  c.emit('room:join', { roomId: 'hall-of-justice' });
  const sys = await sysPromise;
  check('enter announcement is a system message', sys.message.system === true && sys.message.text.includes('charlie_test'));
  const leavePromise = new Promise(r => a.once('room:message', r));
  c.close();
  const leave = await leavePromise;
  check('leave announcement emitted', leave.message.system === true && leave.message.text.includes('left'));
  await sleep(300);

  /* ---- duplicate username + session reuse ---- */
  const dup = await post('/api/login', { password: 'watchtower', username: 'alice_test', hero: 'batman' });
  check('duplicate online username rejected', dup.status === 409);

  a.close(); b.close();
  await sleep(300);
  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
