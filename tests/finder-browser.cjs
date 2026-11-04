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
    // 이미지: 원본 사이트(cdn.mirror.example)와 Yandex 썸네일은 작은 그림, broken.example 원본은 막힘
    if (['cdn.mirror.example', 'avatars.mds.yandex.net'].includes(u.hostname)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    if (u.hostname !== 'gallery.test') return route.abort();
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  // 이미지 검색 결과 페이지: 사이트 목록은 상태 JSON(data-state) 에 실림. 장면마다 다른 결과(mirror 는 장면 1·2 에서 나옴)
  const imagePage = sites => `<div class="Root" data-state="${JSON.stringify({ initialState: { cbirSites: { sites } } }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`;
  // 실제 사본(장면 2장, 제목 일부 일치)과 닮은 사람(장면 3장 모두, 제목 무관 — 실제 Yandex 에서 그대로 나옴)
  const mirror = { url: 'https://mirror.example/watch/123', title: 'Some Model hot video 123', description: 'mirror copy', thumb: { url: '//avatars.mds.yandex.net/i?id=m' }, originalImage: { url: 'https://cdn.mirror.example/orig.jpg' } };
  const lookalike = { url: 'https://news.example/ceo', title: 'CEO ousted from billionaire ranks', thumb: { url: '//avatars.mds.yandex.net/i?id=l' }, originalImage: { url: 'https://broken.example/x.jpg' } };
  const images = [imagePage([lookalike, mirror, { url: 'https://other.example/a', title: 'unrelated' }]), imagePage([lookalike, mirror]), imagePage([lookalike, { url: 'javascript:alert(1)', title: 'bad' }])];
  // "개인 영상 저장" 확장 대신: 웹·동영상 검색 결과 HTML 을 돌려줌 (window.extMode 로 없음·로봇 확인 흉내)
  await page.addInitScript(({ web, video, images }) => {
    window.asked = [];
    window.chrome = { runtime: { sendMessage(id, message, reply) {
      window.asked.push({ id, ...message, jpeg: message.jpeg && message.jpeg.length });
      setTimeout(() => {
        if (window.extMode === 'none') return reply(undefined);
        if (message.type === 'ping') return reply({ ok: true });
        if (window.extMode === 'captcha' || (window.extMode === 'webCaptcha' && message.kind === 'web')) return reply({ ok: true, captcha: true, html: '' });
        if (message.type === 'frames' && window.extMode === 'thumbOnly') return reply({ ok: true, title: 'Thumb only clip', duration: null, frames: [{ at: null, jpeg: btoa('thumb') }] });
        if (message.type === 'frames') return reply({ ok: true, title: 'Some Model clip', duration: 400,
          frames: [100, 200, 300].map(at => ({ at, jpeg: btoa('frame' + at) })) });
        if (message.type === 'yandex-image') return reply({ ok: true, html: images[window.asked.filter(m => m.type === 'yandex-image').length - 1] });
        reply({ ok: true, captcha: false, html: message.kind === 'web' ? web : video });
      }, 10);
    } } };
  }, { web, video, images });
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
    assert.equal(chips.at(-1), '검색', '[검색] comes right after [편집] (수정 ON 에서만 보이는 탭)');
    assert.equal(chips.at(-2), '편집');
    assert.equal(chips.at(-3), '모자이크');
    await page.locator('#catbar').getByRole('button', { name: '검색', exact: true }).click();
    assert.equal(await page.locator('#finderView').count(), 1);
    assert.equal(await page.locator('#grid .card').count(), 0, 'the gallery videos are not shown on the search screen');
    await page.locator('.finder-input').first().fill('Gattouz0 2026-02-08');
    await page.locator('.finder-input').first().press('Enter');
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
    // 링크로 찾기: 장면 3장 → (이름 칸이 비었으니) 영상 제목으로 이름 검색 → 제목 일치 없음 → 장면 3장 이미지 검색
    await page.locator('.finder-input').first().fill('');
    await page.locator('.finder-input').nth(1).fill('https://site.example/v/1');
    await page.getByRole('button', { name: '링크로 찾기', exact: true }).click();
    await page.getByText('비슷한 장면 2/3', { exact: false }).waitFor();
    const calls = await page.evaluate(() => window.asked.slice(-6).map(m => [m.type, m.url || m.query || m.kind, m.jpeg]));
    assert.deepEqual(calls.slice(0, 3).map(c => c.slice(0, 2)), [['frames', 'https://site.example/v/1'], ['yandex-search', 'Some Model clip'], ['yandex-search', 'Some Model clip']]);
    assert.deepEqual(calls.slice(3).map(c => c[0]), ['yandex-image', 'yandex-image', 'yandex-image'], 'all three frames searched');
    assert.equal(await page.locator('.finder-input').first().inputValue(), 'Some Model clip', 'name box filled with the video title');
    assert.deepEqual(await page.locator('.finder-frames figcaption').allTextContents(), ['1:40', '3:20', '5:00']);
    const best = page.locator('.finder-list').first().locator('.finder-item').first();
    assert.equal(await best.getAttribute('href'), 'https://mirror.example/watch/123', 'similar frames + a partly matching title come first');
    assert.match(await best.textContent(), /mirror\.example · 일부 일치 · 비슷한 장면 2\/3/);
    // 원본 이미지가 먼저 (Yandex 썸네일은 성인 이미지면 흐림), 원본이 막히면 Yandex 썸네일로
    await page.waitForFunction(() => [...document.querySelectorAll('.finder-item img')].every(i => i.complete));
    assert.equal(await best.locator('img').getAttribute('src'), 'https://cdn.mirror.example/orig.jpg');
    assert.equal(await page.locator('.finder-item', { hasText: 'CEO ousted' }).locator('img').getAttribute('src'), 'https://avatars.mds.yandex.net/i?id=l');
    assert.equal(await page.locator('.finder-list').first().locator('.finder-item').count(), 1, 'only the copy is "likely"');
    const look = page.locator('.finder-item', { hasText: 'CEO ousted' });
    assert.match(await look.textContent(), /비슷한 장면 3\/3/);
    assert.equal(await look.evaluate(n => n.classList.contains('match')), false, 'a look-alike in every frame is not called the same video');
    assert.equal(await page.locator('.finder-item[href^="javascript"]').count(), 0);
    assert.match(await page.locator('.finder-item', { hasText: 'unrelated' }).textContent(), /비슷한 장면 1\/3/);
    await page.screenshot({ path: path.join(root, 'tests', 'finder-desktop.png'), fullPage: true });
    // 영상 길이를 몰라 페이지 썸네일 한 장만 온 경우: '페이지 썸네일' 로 표시하고 그 한 장으로 이미지 검색
    await page.evaluate(() => { window.extMode = 'thumbOnly'; window.asked.length = 0; });
    await page.locator('.finder-input').first().fill('');
    await page.locator('.finder-input').nth(1).fill('https://late-player.example/video/1');
    await page.getByRole('button', { name: '링크로 찾기', exact: true }).click();
    await page.locator('.finder-frames figcaption', { hasText: '페이지 썸네일' }).waitFor();
    await page.waitForFunction(() => window.asked.filter(m => m.type === 'yandex-image').length === 1 && !document.querySelector('#finderView .hint').textContent.includes('찾는 중'));
    assert.deepEqual(await page.locator('.finder-frames figcaption').allTextContents(), ['페이지 썸네일']);
    await page.evaluate(() => { window.extMode = undefined; });
    // 웹 검색만 로봇 확인에 걸림: 동영상 검색 결과는 보여 주고, 로봇 확인 안내도 함께 (웹 검색 주소로 여는 버튼)
    await page.evaluate(() => { window.extMode = 'webCaptcha'; });
    await page.locator('.finder-input').first().fill('Gattouz0 2026-02-08');
    await page.getByRole('button', { name: '검색', exact: true }).last().click();
    await page.getByText('로봇 확인', { exact: false }).waitFor();
    assert.ok(await page.locator('.finder-item').count() >= 1, 'the video search results still show');
    assert.equal(await page.getByRole('link', { name: 'Yandex 열기' }).getAttribute('href'), 'https://yandex.com/search/?text=Gattouz0%202026-02-08');
    await page.evaluate(() => { window.extMode = 'captcha'; });
    await page.getByRole('button', { name: '검색', exact: true }).last().click();
    await page.getByText('로봇 확인', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Yandex 열기' }).count(), 1);
    await page.evaluate(() => { window.extMode = 'none'; });
    await page.getByRole('button', { name: '검색', exact: true }).last().click();
    await page.getByText('확장이 없거나 꺼져 있어요', { exact: false }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scroll on a phone');
    // 확장 패널 [찾기] 로 열림: #find=표&q=이름 → 바로 [검색] 탭, 표로 장면을 받고 이름 칸에 페이지 제목, 주소에서 표는 지움
    await page.setViewportSize({ width: 1280, height: 900 });
    const ticket = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await page.goto(`https://gallery.test/?fresh#find=${ticket}&q=${encodeURIComponent('Some Model 2026-02-08')}`); // ?fresh: a real load, not a hash change
    await page.evaluate(() => {
      prefetchCandidates = () => {}; needsShare = () => false;
      token = 'fixture'; tokenExp = Date.now() + 3600000;
      gallery = { videos: {}, hidden: {}, tags: {}, fav: {}, hiddenCats: {}, exUse: {}, loved: {}, tagKinds: {}, marks: {}, series: {} };
      items = [{ id: 'a', name: 'a.mp4', mimeType: 'video/mp4', videoMediaMetadata: { durationMillis: '10000' } }];
      $('#setup').hidden = true; renderGrid();
    });
    await page.locator('#finderView').waitFor();
    await page.locator('.finder-frames figure').first().waitFor();
    assert.deepEqual(await page.evaluate(() => { const m = window.asked.find(x => x.type === 'frames'); return [m.id, m.ticket, m.url]; }), ['ipfhbkdamknanblcidakndcjcbajjoke', ticket, undefined]);
    assert.equal(await page.locator('.finder-input').first().inputValue(), 'Some Model 2026-02-08', 'page title in the name box');
    assert.equal(await page.evaluate(() => location.hash), '', 'ticket removed from the address');
    assert.equal(await page.locator('#catbar .chip.on').textContent(), '검색');
    assert.deepEqual(errors, []);
    console.log('finder-browser: ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
