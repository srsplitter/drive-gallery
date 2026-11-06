// 작업(합치기·자동 썸네일·모자이크) 중에는 클릭 없이도 로그인을 저절로 연장 + 팝업이 막히면 안내.
// 독립 브라우저와 가짜 구글 토큰 창으로 확인. 실제 구글 계정에는 접근하지 않는다.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'gallery.test') return route.abort();
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(() => {
      // 가짜 구글 토큰 창: window.popup = 'ok' 이면 새 토큰, 'blocked' 이면 팝업 막힘
      window.asked = 0; window.popup = 'ok';
      tokenClient = { requestAccessToken(opts) {
        window.asked++; window.lastOpts = opts;
        if (window.popup === 'blocked') return tokenClient.error_callback({ type: 'popup_failed_to_open', message: 'Failed to open popup window' });
        tokenClient.callback({ access_token: 'new' + window.asked, expires_in: 3600, scope: SCOPE_WRITE });
      } };
      token = 'old'; tokenScopes = SCOPE_WRITE;
      $('#authBtn').hidden = false; $('#grid').append(document.createElement('div'));
      flushSaves = () => {}; prefetchCandidates = () => {}; runCandJobs = () => {};
      window.scrolled = 0; scrollToNextTodo = () => window.scrolled++;
    });
    // 0) 로그인하면 드라이브에서 계정 이메일을 한 번 받아 두고, 연장할 때 구글 창에 login_hint 로 넘김 (계정 고르기 없이 닫히게)
    await page.evaluate(async () => {
      api = async url => { window.aboutUrl = url; return new Response(JSON.stringify({ user: { emailAddress: 'me@example.com' } })); };
      loadAccount(); await new Promise(r => setTimeout(r, 50));
    });
    assert.match(await page.evaluate(() => window.aboutUrl), /\/about\?fields=user\(emailAddress\)/);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('acct')), 'me@example.com');
    const state = () => page.evaluate(() => ({ asked: window.asked, token, expired: !!$('#authBtn').dataset.expired, status: $('#status').textContent, scrolled: window.scrolled }));
    // 1) 작업이 없으면 만료 3분 전이어도 저절로 연장하지 않음 (평소처럼 클릭할 때만)
    await page.evaluate(async () => { tokenExp = Date.now() + 3 * 60000; await autoRenew(); });
    assert.equal((await state()).asked, 0);
    // 2) 작업 중 + 만료 10분 남음 → 아직 안 함
    await page.evaluate(async () => { MergeUI.jobs.push({ state: 'running', list: [] }); tokenExp = Date.now() + 10 * 60000; await autoRenew(); });
    assert.equal((await state()).asked, 0);
    // 3) 작업 중 + 만료 3분 남음 → 클릭 없이 새 토큰
    await page.evaluate(async () => { tokenExp = Date.now() + 3 * 60000; await autoRenew(); });
    let s = await state();
    assert.equal(s.asked, 1); assert.equal(s.token, 'new1'); assert.equal(s.expired, false);
    assert.ok(await page.evaluate(() => tokenExp - Date.now() > 50 * 60000));
    assert.ok(await page.evaluate(() => window.lastOpts.prompt === '' && window.lastOpts.login_hint === 'me@example.com' && window.lastOpts.scope.includes(SCOPE_WRITE)));
    // 4) 이미 만료돼 🔑 다시 로그인 상태 → 저절로 다시 로그인하고 버튼도 되돌림, 화면은 안 움직임
    await page.evaluate(async () => { autoRenewAt = 0; tokenExp = Date.now() - 1000; markExpired(); await autoRenew(); });
    s = await state();
    assert.equal(s.asked, 2); assert.equal(s.token, 'new2'); assert.equal(s.expired, false);
    assert.equal(await page.locator('#authBtn').textContent(), '로그아웃');
    assert.equal(s.scrolled, 0);
    // 5) 팝업이 막히면 안내를 띄우고, 1분 안엔 다시 시도하지 않음
    await page.evaluate(async () => { autoRenewAt = 0; window.popup = 'blocked'; tokenExp = Date.now() - 1000; markExpired(); await autoRenew(); await autoRenew(); });
    s = await state();
    assert.equal(s.asked, 3); assert.equal(s.expired, true);
    assert.match(s.status, /팝업/);
    // 6) 작업이 끝나면 다시 "작업 없음"
    await page.evaluate(() => { MergeUI.jobs.length = 0; });
    assert.equal(await page.evaluate(() => workBusy()), false);
    assert.deepEqual(errors, []);
    console.log('auto-renew-browser: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
