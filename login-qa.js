/* QA for the new login flow: password every visit, remembered hero name. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3111';
const OUT = path.join(__dirname, 'docs', 'login-qa');
const EXEC = '/usr/local/bin/chromium-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (!cond) failures++; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 400, height: 860, isMobile: true, hasTouch: true });

  const shown = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && getComputedStyle(el).display !== 'none';
  }, sel);

  try {
    /* ---------- 1. first visit: password + pick a hero ---------- */
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);
    check('first visit shows the password step', await shown('#password-form'));
    check('first visit shows no "remembered" line', !(await shown('#returning')));
    await page.screenshot({ path: path.join(OUT, '1-first-visit.png') });

    await page.type('#password', 'watchtower');
    await page.click('#enter-btn');
    await page.waitForSelector('#identity-form:not([hidden])', { timeout: 10000 });
    check('identity step appears for a new hero', await shown('#identity-form'));
    check('no welcome-back note on first visit', !(await shown('#welcome-back')));
    await page.screenshot({ path: path.join(OUT, '2-identity-first-time.png') });

    await page.type('#username', 'brucewayne');
    await page.click('.hero-option[data-hero="batman"]');
    await sleep(150);
    await page.click('#assemble-btn');
    await page.waitForSelector('.side-item', { timeout: 15000 });
    await sleep(600);
    check('entered the chat after assembling', await shown('#chat'));
    const stored = await page.evaluate(() => localStorage.getItem('jl-identity'));
    check('hero name is remembered in storage', !!stored && JSON.parse(stored).username === 'brucewayne');
    await page.screenshot({ path: path.join(OUT, '3-in-chat.png') });

    /* ---------- 2. revisit: password only ---------- */
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(700);
    check('revisit shows the password step again', await shown('#password-form'));
    check('revisit does NOT auto-enter the chat', !(await shown('#chat')));
    check('revisit shows the remembered-hero line', await shown('#returning'));
    const returnText = await page.$eval('#returning-text', el => el.textContent.trim());
    const btnText = await page.$eval('#enter-btn', el => el.textContent.trim());
    check('remembered hero is named on screen', returnText.includes('brucewayne'));
    check('button offers one-tap entry', btnText.includes('brucewayne'));
    await page.screenshot({ path: path.join(OUT, '4-revisit-password-only.png') });

    await page.type('#password', 'watchtower');
    await page.click('#enter-btn');
    await page.waitForSelector('.side-item', { timeout: 15000 });
    await sleep(700);
    check('password alone gets you back in', await shown('#chat'));
    check('identity step was skipped entirely', !(await shown('#identity-form')));
    await page.screenshot({ path: path.join(OUT, '5-back-in-chat.png') });

    /* ---------- 3. wrong password is still rejected ---------- */
    await page.evaluate(() => { localStorage.removeItem('jl-token'); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);
    await page.type('#password', 'wrong-password');
    await page.click('#enter-btn');
    await sleep(900);
    check('wrong password is rejected', await shown('#password-error'));
    check('wrong password does not enter the chat', !(await shown('#chat')));
    await page.screenshot({ path: path.join(OUT, '6-wrong-password.png') });

    /* ---------- 4. "use a different hero" reveals the picker ---------- */
    await page.evaluate(() => { document.querySelector('#password').value = ''; });
    await page.click('#password');
    await page.type('#password', 'watchtower');
    await page.click('#use-different');
    await sleep(200);
    const afterForget = await page.evaluate(() => localStorage.getItem('jl-identity'));
    check('"use a different hero" forgets the stored name', afterForget === null);
    check('remembered line hidden after choosing to switch', !(await shown('#returning')));
    await page.click('#enter-btn');
    await page.waitForSelector('#identity-form:not([hidden])', { timeout: 10000 });
    check('identity step shown when switching hero', await shown('#identity-form'));
    await page.screenshot({ path: path.join(OUT, '7-switch-hero.png') });

    /* ---------- 5. empty channel mentions the retention window ---------- */
    await page.evaluate(() => {
      const u = document.querySelector('#username'); u.value = 'brucewayne';
      document.querySelector('.hero-option[data-hero="batman"]').click();
    });
    await sleep(150);
    await page.click('#assemble-btn');
    await page.waitForSelector('.side-item', { timeout: 15000 });
    await sleep(500);
    await page.click('#menu-btn');
    await sleep(400);
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#room-list .side-item')];
      const metropolis = items.find(i => i.textContent.includes('Metropolis'));
      if (metropolis) metropolis.click();
    });
    await sleep(900);
    const emptyText = await page.$eval('#empty-text', el => el.textContent.trim());
    check('empty channel explains the 3-day window', /last 3 days/.test(emptyText));
    await page.screenshot({ path: path.join(OUT, '8-empty-channel.png') });

    console.log('\n' + (failures === 0 ? 'LOGIN FLOW QA PASSED' : failures + ' LOGIN FLOW CHECK(S) FAILED'));
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (e) {
    console.error('QA ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
