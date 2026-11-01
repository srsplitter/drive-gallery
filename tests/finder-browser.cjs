// [검색] 탭: 확장 대신 가짜 응답(실제 Yandex 결과와 같은 구조)으로 확인. Yandex·구글 계정에는 접근하지 않는다.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const web = `<ul>
  <li class="serp-item serp-item_card"><a class="Link OrganicHost-Link" href="https://onlyjerk.net/tag/gattouz0/"></a>
    <a class="Link OrganicTitle-Link" href="https://onlyjerk.net/tag/gattouz0/">Gattouz0 | Onlyjerk</a><div class="OrganicText">tag page</div></li>
  <li class="serp-item serp-item_card"><a class="Link OrganicTitle-Link" href="https://kittykawai.com/gattouz0-2026-02-08-2/">Gattouz0 2026-02-08 - KittyKawai</a>
    <div class="OrganicText">Gattouz0 2026-02-08 - Porn Asian Kawai Videos</div></li>
  <li class="serp-item serp-item_card"><a class="Link OrganicTitle-Link" href="javascript:alert(1)">Gattouz0 2026-02-08 bad link</a></li>
</ul>`;
const video = `<ul>
  <li class="SearchBlock"><div class="VideoSnippet"><a class="Link VideoThumb3" href="https://yandex.com/video/preview/1">1:54:02</a>
    <video class="VideoThumb3-Video" poster="https://avatars.mds.yandex.net/get-vthumb/1/abc/564x318"></video>
    <a class="Link VideoSnippet-Title" href="https://yandex.com/video/preview/1">Gattouz0 2026-02-08 full</a>
    <a class="Link VideoHostExtended-Host" href="https://pornavhd.com/2026/02/21/gattouz0_2026-02-08/">pornavhd</a></div></li>
  <li class="SearchBlock"><div class="VideoSnippet"><a class="Link VideoThumb3" href="https://yandex.com/video/preview/2">3:32</a>
    <a class="Link VideoSnippet-Title" href="https://yandex.com/video/preview/2">gattouz0 VS Franco</a>
    <a class="Link VideoHostExtended-Host" href="http://www.youtube.com/watch?v=x">YouTube</a></div></li>
</ul>`;
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
  // "개인 영상 저장" 확장 대신: 웹·동영상 검색 결과 HTML 을 돌려줌 (window.extMode 로 없음·로봇 확인 흉내)
  await page.addInitScript(({ web, video }) => {
    window.asked = [];
    window.chrome = { runtime: { sendMessage(id, message, reply) {
      window.asked.push({ id, ...message });
      setTimeout(() => {
        if (window.extMode === 'none') return reply(undefined);
        if (message.type === 'ping') return reply({ ok: true });
        if (window.extMode === 'captcha') return reply({ ok: true, captcha: true, html: '' });
        reply({ ok: true, captcha: false, html: message.kind === 'web' ? web : video });
      }, 10);
    } } };
  }, { web, video });
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(() => {
      prefetchCandidates = () => {}; needsShare = () => false;
      token = 'fixture'; tokenExp = Date.now() + 3600000;
      gallery = { videos: {}, hidden: {}, tags: {}, fav: {}, hiddenCats: {}, exUse: {}, loved: {}, tagKinds: {}, marks: {}, series: {} };
      items = [{ id: 'a', name: 'a.mp4', mimeType: 'video/mp4', videoMediaMetadata: { durationMillis: '10000' } }];
      $('#setup').hidden = true; renderGrid();
    });
    const chips = await page.locator('#catbar .catscroll .chip').allTextContents();
    assert.equal(chips.at(-1), '검색', '[검색] comes right after [모자이크]');
    assert.equal(chips.at(-2), '모자이크');
    await page.locator('#catbar').getByRole('button', { name: '검색', exact: true }).click();
    assert.equal(await page.locator('#finderView').count(), 1);
    assert.equal(await page.locator('#grid .card').count(), 0, 'the gallery videos are not shown on the search screen');
    await page.locator('.finder-input').fill('Gattouz0 2026-02-08');
    await page.locator('.finder-input').press('Enter');
    await page.locator('.finder-item').first().waitFor();
    const asked = await page.evaluate(() => window.asked.filter(m => m.type === 'yandex-search').map(m => [m.id, m.kind, m.query]));
    assert.deepEqual(asked, [['ipfhbkdamknanblcidakndcjcbajjoke', 'web', 'Gattouz0 2026-02-08'], ['ipfhbkdamknanblcidakndcjcbajjoke', 'video', 'Gattouz0 2026-02-08']]);
    const exact = await page.locator('#finderView .finder-list').first().locator('.finder-item').evaluateAll(ns => ns.map(n => n.href));
    assert.deepEqual(exact.sort(), ['https://kittykawai.com/gattouz0-2026-02-08-2/', 'https://pornavhd.com/2026/02/21/gattouz0_2026-02-08/'], 'title matches first');
    assert.match(await page.locator('.finder-item.match', { hasText: 'full' }).textContent(), /pornavhd\.com · 1:54:02 · 제목 일치/);
    assert.equal(await page.locator('.finder-item.match img').getAttribute('src'), 'https://avatars.mds.yandex.net/get-vthumb/1/abc/564x318');
    assert.equal(await page.locator('.finder-item[href^="javascript"]').count(), 0, 'non-http links dropped');
    assert.equal(await page.locator('.finder-item').count(), 4);
    assert.equal(await page.locator('.finder-item').first().getAttribute('target'), '_blank');
    await page.screenshot({ path: path.join(root, 'tests', 'finder-desktop.png'), fullPage: true });
    await page.evaluate(() => { window.extMode = 'captcha'; });
    await page.getByRole('button', { name: '검색', exact: true }).last().click();
    await page.getByText('로봇 확인', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Yandex 열기' }).count(), 1);
    await page.evaluate(() => { window.extMode = 'none'; });
    await page.getByRole('button', { name: '검색', exact: true }).last().click();
    await page.getByText('확장이 없거나 꺼져 있어요', { exact: false }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on a phone');
    assert.deepEqual(errors, []);
    console.log('finder-browser: ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
