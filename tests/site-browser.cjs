// [사이트] 탭(파란 사이트 태그, 태그↔사이트 이동, 줄마다 대표 썸네일·사이트 주소, 줄을 누르면 그 줄 아래에 영상) + 카드 태그 줄에서 바로 태그 추가.
// 독립 브라우저와 가짜 갤러리 데이터로 확인. 실제 구글 계정에는 접근하지 않는다.
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
  const changes = () => page.evaluate(() => Object.fromEntries(window.savedChanges));
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(() => {
      prefetchCandidates = () => {}; needsShare = () => false;
      token = 'fixture'; tokenExp = Date.now() + 3600000;
      window.savedChanges = [];
      flushSaves = async () => { window.savedChanges.push(...pendingSaves); pendingSaves.clear(); };
      gallery = { videos: {}, hidden: {}, tags: { a: ['pornhub', '게임'], b: ['pornhub'], c: ['missav'] }, fav: {}, hiddenCats: {}, exUse: {}, loved: {},
        tagKinds: { missav: 'site', '게임': 'category' }, marks: {}, series: {}, order: {}, covers: {}, settings: {}, knownTags: {}, siteUrls: { missav: 'https://missav.ws/' } };
      items = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id + '.mp4', mimeType: 'video/mp4', videoMediaMetadata: { durationMillis: '10000' } }));
      $('#setup').hidden = true; $('#editBtn').hidden = false; $('#authBtn').hidden = false;
      renderGrid();
    });
    // 1) [사이트] 는 [타이틀] 과 [모자이크] 사이
    const chips = await page.locator('#catbar .catscroll .chip').allTextContents();
    assert.equal(chips.indexOf('사이트'), chips.indexOf('타이틀') + 1);
    assert.equal(chips.indexOf('모자이크'), chips.indexOf('사이트') + 1);
    // 2) 사이트 태그는 파란 테두리 (카드 태그)
    assert.equal(await page.locator('.card[data-id="c"] .card-tags span.tag-kind-site').evaluate(n => getComputedStyle(n).borderTopColor), 'rgb(76, 141, 255)');
    // 3) [태그] 목록 맨 아래 "사이트(으)로 이동" → pornhub 를 사이트로
    await page.evaluate(() => setEditMode(true));
    await page.locator('#catbar').getByRole('button', { name: '태그', exact: true }).click();
    const tagMemos = await page.locator('#directoryMemos .m-sec > b').allTextContents();
    assert.ok(tagMemos.includes('사이트(으)로 이동'), JSON.stringify(tagMemos));
    const toSite = page.locator('#directoryMemos .m-sec').filter({ has: page.getByText('사이트(으)로 이동', { exact: true }) });
    await toSite.locator('textarea').fill('pornhub');
    await toSite.locator('textarea').press('Enter');
    assert.equal(await page.evaluate(() => gallery.tagKinds.pornhub), 'site');
    assert.equal((await changes())['k:pornhub'], 'site');
    // 4) [사이트] 목록: 한 줄씩, 메모는 "태그(으)로 이동" 하나. 수정 ON 에서는 주소 칸이 없고 주소가 있으면 이름이 링크
    await page.locator('#catbar').getByRole('button', { name: '사이트', exact: true }).click();
    assert.deepEqual(await page.locator('.site-row').evaluateAll(ns => ns.map(n => n.dataset.tag)), ['missav', 'pornhub']);
    assert.deepEqual(await page.locator('#directoryMemos .m-sec > b').allTextContents(), ['태그(으)로 이동']);
    assert.equal(await page.locator('.site-row .site-link').count(), 0, 'edit ON hides the address slot');
    const missavName = page.locator('.site-row[data-tag="missav"] a.site-name');
    assert.equal(await missavName.getAttribute('href'), 'https://missav.ws/');
    assert.equal(await missavName.getAttribute('target'), '_blank');
    assert.equal(await page.locator('.site-row[data-tag="pornhub"] a.site-name').count(), 0, 'no address → the name is plain text');
    assert.equal(await page.locator('.site-row[data-tag="missav"] .cover-thumb').count(), 1, 'rows show a cover thumbnail');
    // 5) 수정 ON: 이름 말고 칸을 누르면 그 줄 바로 아래에 대표 썸네일 고르기 + 주소 칸 + 그 영상
    await page.locator('.site-row[data-tag="missav"] .cnt').click();
    const order = () => page.locator('#siteList > *').evaluateAll(ns => ns.map(n => n.dataset.coverKey || n.className));
    assert.deepEqual(await order(), ['tag:missav', 'site-videos', 'tag:pornhub'], 'videos sit right under their row');
    assert.equal(await page.locator('.site-videos h2').textContent(), 'missav (1)');
    await page.locator('.site-row[data-tag="pornhub"] b').click();
    assert.deepEqual(await order(), ['tag:missav', 'tag:pornhub', 'site-videos']);
    assert.deepEqual((await page.locator('.site-videos .card').evaluateAll(ns => ns.map(n => n.dataset.id))).sort(), ['a', 'b']);
    const picks = page.locator('.directory-item[data-cover-key="tag:pornhub"] .cover-candidate');
    assert.equal(await picks.count(), 2);
    await page.locator('.directory-item[data-cover-key="tag:pornhub"] .cover-candidate[data-video-id="b"]').click();
    assert.equal(await page.evaluate(() => gallery.covers['tag:pornhub']), 'b');
    assert.equal((await changes())['p:tag:pornhub'], 'b');
    const slot = page.locator('.site-url-edit .site-link');
    assert.equal(await slot.textContent(), '', 'a site just moved from tags has an empty address slot');
    await slot.click();
    await page.locator('.site-url-in').fill('pornhub.com');
    await page.locator('.site-url-in').press('Enter');
    assert.equal(await page.evaluate(() => gallery.siteUrls.pornhub), 'https://pornhub.com/');
    assert.equal((await changes())['w:pornhub'], 'https://pornhub.com/');
    assert.equal(await page.locator('.site-row[data-tag="pornhub"] a.site-name').getAttribute('href'), 'https://pornhub.com/');
    await page.locator('.site-url-edit .site-link').click();
    await page.locator('.site-url-in').fill('javascript:alert(1)');
    await page.locator('.site-url-in').press('Enter');
    assert.equal(await page.locator('.site-url-in').count(), 1, 'a non-http address is not saved');
    await page.locator('.site-url-in').press('Escape');
    assert.equal(await page.evaluate(() => gallery.siteUrls.pornhub), 'https://pornhub.com/');
    await page.screenshot({ path: path.join(root, 'tests', 'site-edit.png'), fullPage: true });
    await page.locator('.site-row[data-tag="pornhub"] .cnt').click();
    assert.equal(await page.locator('.site-videos').count(), 0, 'clicking again closes it');
    // 6) 수정 OFF: 이름은 글자, 주소 칸은 새 탭으로 여는 링크
    await page.evaluate(() => setEditMode(false));
    const link = page.locator('.site-row[data-tag="pornhub"] a.site-link');
    assert.equal(await link.getAttribute('href'), 'https://pornhub.com/');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await page.locator('a.site-name').count(), 0);
    // 7) 주소 칸 말고 줄을 누르면 그 줄 바로 아래에 그 태그의 영상, 다시 누르면 닫힘
    await page.locator('.site-row[data-tag="missav"] .site-main').click();
    assert.deepEqual(await order(), ['tag:missav', 'site-videos', 'tag:pornhub']);
    assert.equal(await page.locator('#siteView h2').textContent(), 'missav (1)');
    await page.locator('.site-row[data-tag="missav"] .site-main').click();
    await page.locator('.site-row[data-tag="pornhub"] .site-main').click();
    assert.equal(await page.locator('#siteView h2').textContent(), 'pornhub (2)');
    assert.deepEqual((await page.locator('#siteView .card').evaluateAll(ns => ns.map(n => n.dataset.id))).sort(), ['a', 'b']);
    await page.screenshot({ path: path.join(root, 'tests', 'site-desktop.png'), fullPage: true });
    await page.locator('.site-row[data-tag="pornhub"] .site-main').click();
    assert.equal(await page.locator('#siteView h2').count(), 0);
    // 8) 사이트 → 태그로 되돌리기
    await page.evaluate(() => setEditMode(true));
    const toTag = page.locator('#directoryMemos .m-sec').filter({ has: page.getByText('태그(으)로 이동', { exact: true }) });
    await toTag.locator('textarea').fill('pornhub');
    await toTag.locator('textarea').press('Enter');
    assert.equal(await page.evaluate(() => gallery.tagKinds.pornhub), undefined);
    assert.deepEqual(await page.locator('.site-row').evaluateAll(ns => ns.map(n => n.dataset.tag)), ['missav']);
    // 9) 이름을 바꾸면 주소도 따라감
    await page.evaluate(() => renameTag('missav', 'missav2'));
    assert.deepEqual(await page.evaluate(() => gallery.siteUrls), { pornhub: 'https://pornhub.com/', missav2: 'https://missav.ws/' });
    // 10) 모든 영상 + 수정 ON: 카드 태그 줄을 누르면 바로 태그 추가 (띄어쓰기도 쉼표)
    await page.locator('#catbar').getByRole('button', { name: '사이트', exact: true }).click(); // 다시 눌러 모든 영상으로
    await page.locator('.card[data-id="c"] .card-tags').click();
    const input = page.locator('input.card-in');
    await input.pressSequentially('새태그 다른');
    await input.press('Enter');
    assert.deepEqual(await page.evaluate(() => gallery.tags.c), ['missav2', '새태그', '다른']);
    assert.equal(await page.locator('#viewer[open]').count(), 0, 'the video did not open');
    // 태그가 없는 카드는 수정 ON 에서만 "＋ 태그" 자리
    const empty = page.locator('.card[data-id="d"] .card-tags-empty');
    assert.equal(await empty.isVisible(), true);
    await page.waitForTimeout(450);
    await empty.click();
    await page.locator('input.card-in').fill('하나');
    await page.locator('input.card-in').press('Escape');
    assert.equal(await page.evaluate(() => gallery.tags.d), undefined, 'Esc adds nothing');
    await page.waitForTimeout(450); // 입력을 막 끝낸 직후의 클릭은 무시 (제목 고치기와 같은 400ms)
    await page.locator('.card[data-id="d"] .card-tags-empty').click();
    await page.locator('input.card-in').fill('하나');
    await page.locator('input.card-in').press('Enter');
    assert.deepEqual(await page.evaluate(() => gallery.tags.d), ['하나']);
    await page.evaluate(() => setEditMode(false));
    assert.equal(await page.locator('.card-tags-empty').count(), 0);
    assert.deepEqual(errors, []);
    console.log('site-browser: ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
