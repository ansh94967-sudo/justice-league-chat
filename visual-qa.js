/* Visual QA: drive the app in headless Chromium and capture screenshots */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3111';
const OUT = path.join(__dirname, 'docs');
const EXEC = '/usr/local/bin/chromium-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gate(page, shot) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, shot) });
}

async function login(page, username, heroIndex) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#password', { timeout: 15000 });
  await page.type('#password', 'watchtower');
  await page.click('#password-form button[type=submit]');
  await page.waitForSelector('#identity-form:not([hidden])', { timeout: 10000 });
  await page.type('#username', username);
  await page.click(`.hero-option[data-hero="${heroIndex}"]`);
  await sleep(150);
  await page.click('#assemble-btn');
  await page.waitForSelector('#sidebar', { timeout: 15000 });
  await page.waitForSelector('.side-item', { timeout: 15000 });
  await sleep(500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
    defaultViewport: { width: 1440, height: 860 }
  });

  try {
    /* 1 — the gate (password step) */
    const pA = await browser.newPage();
    await gate(pA, 'screenshot-gate.png');

    /* 2 — identity step */
    await pA.type('#password', 'watchtower');
    await pA.click('#password-form button[type=submit]');
    await pA.waitForSelector('#identity-form:not([hidden])', { timeout: 10000 });
    await sleep(700);
    await pA.screenshot({ path: path.join(OUT, 'screenshot-identity.png') });

    /* 3 — finish login as alice */
    await pA.type('#username', 'wonder_leader');
    await pA.click('.hero-option[data-hero="wonder-woman"]');
    await sleep(200);
    await pA.click('#assemble-btn');
    await pA.waitForSelector('.side-item', { timeout: 15000 });
    await sleep(600);
    await pA.screenshot({ path: path.join(OUT, 'screenshot-chat-empty.png') });

    /* 4 — second user joins and chats */
    const pB = await browser.newPage();
    await login(pB, 'speed_force', 'flash');

    // bob sends group messages
    const input = await pB.$('#message-input');
    for (const text of [
      'Watchtower, come in! We have a situation in Metropolis.',
      'Anyone on patrol tonight? 🦇',
      'Meet me at the coordinates — https://watchtower.league/ops'
    ]) {
      await input.type(text);
      await pB.keyboard.press('Enter');
      await sleep(400);
    }

    // alice replies twice (grouped messages)
    const inputA = await pA.$('#message-input');
    await inputA.type('Copy that, Flash. On my way. ⚡');
    await pA.keyboard.press('Enter');
    await sleep(300);
    await inputA.type('Bringing the lasso.');
    await pA.keyboard.press('Enter');
    await sleep(900);

    /* 5 — react to alice's message from bob (hover + click ⚡) */
    await pB.hover('.messages .msg:last-child');
    await sleep(250);
    const reactBtns = await pB.$$('.messages .msg:last-child .react-btn');
    if (reactBtns.length) { await reactBtns[0].click(); await sleep(400); }

    /* typing indicator visible on alice's side */
    await input.type('Hmm');
    await sleep(1200);

    await pA.screenshot({ path: path.join(OUT, 'screenshot-chat.png') });

    /* 6 — DM view for alice */
    const memberItem = await pA.$('#member-list .side-item');
    if (memberItem) {
      await memberItem.click();
      await sleep(400);
      const dmInput = await pA.$('#message-input');
      await dmInput.type('Flash — private line. The Watchtower has been compromised.');
      await pA.keyboard.press('Enter');
      await sleep(600);
      await pB.waitForSelector('#dm-list .side-item', { timeout: 10000 });
      // bob opens the DM and replies
      const dmItem = await pB.$('#dm-list .side-item');
      await dmItem.click();
      await sleep(400);
      const dmInputB = await pB.$('#message-input');
      await dmInputB.type('Acknowledged. Heading to the bridge now.');
      await pB.keyboard.press('Enter');
      await sleep(700);
      await pA.screenshot({ path: path.join(OUT, 'screenshot-dm.png') });
      await pB.screenshot({ path: path.join(OUT, 'screenshot-dm-bob.png') });
    }

    /* 7 — mobile viewport */
    await pA.setViewport({ width: 390, height: 800 });
    await sleep(500);
    await pA.screenshot({ path: path.join(OUT, 'screenshot-mobile.png') });
    await pA.click('#menu-btn');
    await sleep(500);
    await pA.screenshot({ path: path.join(OUT, 'screenshot-mobile-menu.png') });

    console.log('SCREENSHOTS DONE');
  } catch (e) {
    console.error('QA ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
