// 1초 썸네일을 넣었어도 드라이브 썸네일이 갤러리 썸네일과 같은 영상만 빗금을 풂.
// 드라이브 썸네일은 가짜 그림.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.protocol === 'data:') return route.continue();
    if (u.hostname !== 'gallery.test') return route.abort();
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: /.m?js$/.test(file) ? 'application/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(async () => {
      extReady = true; extVersion = '2.1'; extCall = async (type, { url }) => ({ ok: true, data: url }); // 확장이 드라이브 썸네일을 대신 받아 줌 (가짜)
      prefetchCandidates = () => {}; needsShare = () => false; token = 'fixture'; tokenExp = Date.now() + 3600000; flushSaves = async () => {};
      const draw = flip => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 160, 0); g.addColorStop(flip ? 1 : 0, '#000'); g.addColorStop(flip ? 0 : 1, '#fff'); x.fillStyle = g; x.fillRect(0, 0, 160, 90); return c.toDataURL('image/png'); };
      const A = draw(false), B = draw(true);
      window.A = A; window.B = B;
      gallery = { videos: { same: { thumb: A }, diff: { thumb: A }, none: { thumb: A }, later: { thumb: A } }, hidden: {}, tags: {}, fav: {}, hiddenCats: {}, exUse: {}, loved: {}, tagKinds: {}, marks: {}, series: {}, order: {}, covers: {}, settings: {}, knownTags: {}, siteUrls: {},
        intro: { same: true, diff: true, later: true } };
      const v = (id, link) => ({ id, name: id + '.mp4', size: '900', mimeType: 'video/mp4', parents: ['p'], thumbnailLink: link, thumbnailVersion: '1', videoMediaMetadata: { durationMillis: '10000' } });
      items = [v('same', A), v('diff', B), v('none', A), v('later', B)];
      $('#setup').hidden = true; $('#editBtn').hidden = false; $('#authBtn').hidden = false;
      setEditMode(true);
      renderGrid();
    });
    const ids = sel => page.locator(sel).evaluateAll(ns => ns.map(n => n.dataset.id).sort());
    // 같은 영상만 빗금 해제. 1초 안 넣은 영상, 드라이브 썸네일이 다른 영상은 빗금 유지
    await page.waitForFunction(() => document.querySelectorAll('#regularVideos .card.no-intro').length === 3);
    assert.deepEqual(await ids('#regularVideos .card.no-intro'), ['diff', 'later', 'none']);
    // 자동 썸네일 탭: 다른 영상도 다시 나오고, 같은 영상은 안 보임
    await page.locator('.merge-tab').click();
    await page.locator('#mergePanel .merge-tabs .chip', { hasText: '자동 썸네일' }).click();
    assert.deepEqual(await ids('#regularVideos .card'), ['diff', 'later', 'none']);
    // 드라이브가 썸네일을 새로 만들어 같아지면(버전 변경) 다시 비교해 빠짐
    await page.evaluate(() => { const f = items.find(x => x.id === 'later'); f.thumbnailLink = window.A; f.thumbnailVersion = '2'; IntroCheck.recheck(); });
    await page.waitForFunction(() => !document.querySelector('#regularVideos .card[data-id="later"]'));
    // 지정 썸네일을 바꾸면 다시 빗금
    await page.evaluate(() => { gallery.videos.same.thumb = window.B; renderGrid(); });
    await page.waitForFunction(() => !!document.querySelector('#regularVideos .card[data-id="same"]'));
    // 드라이브가 저장·변환 중인 영상은 대기열에서 빠짐: 썸네일 없음 / 길이 정보 없음 / 덮어 올린 뒤 새 썸네일 전
    const inQueue = id => page.evaluate(id => !!document.querySelector(`#regularVideos .card[data-id="${id}"]`), id);
    await page.evaluate(() => { const f = items.find(x => x.id === 'none'); window.link = f.thumbnailLink; f.thumbnailLink = ''; IntroCheck.recheck(); });
    await page.waitForFunction(() => !document.querySelector('#regularVideos .card[data-id="none"]'));
    await page.evaluate(() => { const f = items.find(x => x.id === 'none'); f.thumbnailLink = window.link; f.videoMediaMetadata = {}; renderGrid(); });
    assert.equal(await inQueue('none'), false);
    await page.evaluate(() => { const f = items.find(x => x.id === 'none'); f.videoMediaMetadata = { durationMillis: '10000' }; IntroCheck.recheck(); });
    await page.waitForFunction(() => !!document.querySelector('#regularVideos .card[data-id="none"]'));
    await page.evaluate(() => { IntroCheck.uploaded(items.find(x => x.id === 'diff')); renderGrid(); });
    assert.equal(await inQueue('diff'), false, 'just uploaded');
    assert.equal(await page.evaluate(() => IntroCheck.processing(items.find(x => x.id === 'diff'))), true);
    // 새 썸네일이 나왔는데 여전히 다르면 다시 대기열로
    await page.evaluate(() => { items.find(x => x.id === 'diff').thumbnailVersion = '2'; IntroCheck.recheck(); });
    await page.waitForFunction(() => !!document.querySelector('#regularVideos .card[data-id="diff"]'));
    // 확장이 없으면(폰 등) 그림을 못 읽으니 비교하지 않고 '넣었음' 기록만 봄 → 넣은 영상은 빗금 없음
    await page.evaluate(() => { extReady = false; MergeUI.toggleMode(); });
    assert.deepEqual(await ids('#regularVideos .card.no-intro'), ['none']);
    assert.deepEqual(errors, []);
    console.log('intro-check-browser: ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
