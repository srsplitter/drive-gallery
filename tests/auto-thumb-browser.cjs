// [편집] 탭(모자이크와 검색 사이) + 편집 화면 위쪽 탭 [영상 합치기]/[자동 썸네일] + 맨 앞 1초 썸네일을 안 넣은 영상의 이름 빗금.
// 독립 브라우저와 가짜 갤러리 데이터로 확인. 다시 압축(VideoMerge.merge)과 드라이브 올리기는 가짜로 바꿔 끼우고, 실제 구글 계정에는 접근하지 않는다.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [], puts = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'gallery.test') return route.abort();
    if (u.pathname.startsWith('/upload/')) { // 가짜 드라이브 재개 업로드: 마지막 조각에 파일 정보로 답함
      const id = u.pathname.slice(8);
      puts.push(id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, size: '1000', mimeType: 'video/mp4' }) });
    }
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  const changes = () => page.evaluate(() => Object.fromEntries(window.savedChanges));
  const ids = sel => page.locator(sel).evaluateAll(ns => ns.map(n => n.dataset.id));
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(PNG => {
      prefetchCandidates = () => {}; needsShare = () => false; ensureWriteScope = async () => true;
      token = 'fixture'; tokenExp = Date.now() + 3600000;
      window.savedChanges = [];
      flushSaves = async () => { window.savedChanges.push(...pendingSaves); pendingSaves.clear(); };
      // 드라이브 API: 업로드 시작만 받아 가짜 업로드 주소를 줌
      window.uploadStarts = [];
      api = async (url, opts = {}) => {
        const m = url.match(/\/upload\/drive\/v3\/files\/([^?]+)\?uploadType=resumable/);
        if (!m) throw new Error('unexpected api ' + url);
        window.uploadStarts.push(m[1]);
        return new Response('', { headers: { Location: 'https://gallery.test/upload/' + m[1] } });
      };
      // 다시 압축: 영상마다 window.gate[id] 가 풀릴 때까지 기다렸다가 1000바이트를 씀 (취소하면 멈춤)
      window.gate = {}; window.merged = [];
      VideoMerge.merge = async ({ parts, writable, signal, onProgress }) => {
        const id = items.find(f => f.name === parts[0].name).id;
        window.merged.push({ id, intro: !!parts[0].intro });
        onProgress({ done: 0.5, total: 1, part: 0 });
        await new Promise((ok, bad) => {
          if (!window.gate[id]) return ok();
          window.gate[id].then(ok);
          signal.addEventListener('abort', () => bad(new DOMException('취소했어요', 'AbortError')));
        });
        const w = writable.getWriter();
        await w.write({ position: 0, data: new Uint8Array(1000) });
        await w.close();
      };
      gallery = { videos: { a: { thumb: PNG }, d: { thumb: PNG }, e: { thumb: PNG } }, hidden: {}, tags: { a: ['게임', '마리오'], b: ['게임'] }, fav: {}, hiddenCats: {}, exUse: {}, loved: { a: true },
        tagKinds: {}, marks: {}, series: {}, order: {}, covers: {}, settings: {}, knownTags: {}, siteUrls: {}, intro: { c: true } };
      items = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id + '.mp4', size: '900', mimeType: 'video/mp4', parents: ['p'], videoMediaMetadata: { durationMillis: '10000' } }));
      $('#setup').hidden = true; $('#editBtn').hidden = false; $('#authBtn').hidden = false;
      renderGrid();
    }, PNG);
    // 1) 헤더 [편집] 버튼은 없어지고, 카테고리 바 [편집] 탭은 수정 ON 에서만 [모자이크]와 [검색] 사이
    assert.equal(await page.locator('#mergeBtn').count(), 0);
    assert.equal(await page.locator('.merge-tab').isVisible(), false, 'edit OFF hides the 편집 tab');
    await page.evaluate(() => setEditMode(true));
    const chips = await page.locator('#catbar .catscroll .chip:visible').allTextContents();
    assert.equal(chips.indexOf('편집'), chips.indexOf('모자이크') + 1, JSON.stringify(chips));
    assert.equal(chips.indexOf('검색'), chips.indexOf('편집') + 1);
    // 2) 맨 앞 1초 썸네일을 안 넣은 영상은 이름 칸 빗금, 넣은 영상(c)은 빗금 없음
    assert.deepEqual(await ids('#regularVideos .card.no-intro'), ['a', 'b', 'd', 'e']);
    assert.notEqual(await page.locator('.card[data-id="a"] > .name').first().evaluate(n => getComputedStyle(n).backgroundImage), 'none');
    assert.equal(await page.locator('.card[data-id="c"] > .name').first().evaluate(n => getComputedStyle(n).backgroundImage), 'none');
    // 3) [편집] → 위쪽 탭 두 개, 처음은 [영상 합치기]
    await page.locator('.merge-tab').click();
    assert.deepEqual(await page.locator('#mergePanel .merge-tabs .chip').allTextContents(), ['영상 합치기', '자동 썸네일']);
    assert.equal(await page.locator('#mergePanel .merge-tabs .chip.on').textContent(), '영상 합치기');
    assert.equal(await page.locator('#mergePanel').getByText('합친 영상 이름', { exact: true }).count(), 1);
    // 4) [자동 썸네일]: 이미 넣은 c 는 안 보이고, 지정 썸네일 없는 b 는 흐리고 못 고름
    await page.locator('#mergePanel .merge-tabs').getByRole('button', { name: '자동 썸네일' }).click();
    assert.deepEqual((await ids('#regularVideos .card')).sort(), ['a', 'b', 'd', 'e']);
    assert.deepEqual(await ids('#regularVideos .card.auto-nothumb'), ['b']);
    await page.locator('#regularVideos .card[data-id="b"]').click();
    assert.equal(await page.locator('.card.merge-picked').count(), 0, 'a video without a set thumbnail cannot be picked');
    assert.equal(await page.locator('#viewer[open]').count(), 0);
    // 5) a 를 고르고 시작 → 지정 썸네일을 맨 앞 1초로 넣어 같은 파일(a)에 덮어씀 → 사이트 정보 그대로, 목록에서 빠짐
    await page.locator('#regularVideos .card[data-id="a"]').click();
    assert.deepEqual(await ids('#regularVideos .card.merge-picked'), ['a']);
    await page.locator('#mergePanel').getByRole('button', { name: '1개 자동 썸네일 넣기' }).click();
    await page.waitForFunction(() => gallery.intro.a === true);
    assert.deepEqual(await page.evaluate(() => window.merged), [{ id: 'a', intro: true }]);
    assert.deepEqual(await page.evaluate(() => window.uploadStarts), ['a'], 'overwrites the same Drive file');
    assert.equal((await changes())['i:a'], true);
    assert.deepEqual(await page.evaluate(() => [items.map(f => f.id), gallery.tags.a, gallery.loved.a, items.find(f => f.id === 'a').size]),
      [['a', 'b', 'c', 'd', 'e'], ['게임', '마리오'], true, '1000']);
    await page.waitForFunction(() => !document.querySelector('#regularVideos .card[data-id="a"]'));
    assert.match(await page.locator('#mergePanel .merge-job').textContent(), /끝났어요/);
    // 6) 다른 탭에 가도 작업은 계속: d 를 시작해 두고 [태그] 탭으로 → 압축이 끝나면 다 올라감
    await page.evaluate(() => { window.gate.d = new Promise(r => { window.releaseD = r; }); });
    await page.locator('#regularVideos .card[data-id="d"]').click();
    await page.locator('#mergePanel').getByRole('button', { name: '1개 자동 썸네일 넣기' }).click();
    await page.waitForFunction(() => window.merged.some(m => m.id === 'd'));
    await page.locator('#catbar').getByRole('button', { name: '태그', exact: true }).click();
    assert.equal(await page.evaluate(() => MergeUI.active), false, 'leaving closes only the edit screen');
    assert.match(await page.locator('#mergePanel').textContent(), /자동 썸네일 작업/, 'job progress stays visible in other tabs');
    await page.evaluate(() => window.releaseD());
    await page.waitForFunction(() => gallery.intro.d === true);
    assert.equal(await page.locator('.card[data-id="d"].no-intro').count(), 0);
    // 7) 취소: 다 올라가기 전에 멈추면 드라이브에 손대지 않고 원본 그대로 (넣음 표시도 없음)
    await page.locator('#catbar').getByRole('button', { name: '태그', exact: true }).click();
    await page.locator('.merge-tab').click();
    assert.equal(await page.locator('#mergePanel .merge-tabs .chip.on').textContent(), '자동 썸네일', 'remembers the last edit tab');
    await page.evaluate(() => { window.gate.e = new Promise(() => {}); });
    await page.locator('#regularVideos .card[data-id="e"]').click();
    await page.locator('#mergePanel').getByRole('button', { name: '1개 자동 썸네일 넣기' }).click();
    await page.waitForFunction(() => window.merged.some(m => m.id === 'e'));
    const eJob = page.locator('#mergePanel .merge-job[data-state="running"]');
    await eJob.getByRole('button', { name: '취소' }).click();
    await page.waitForFunction(() => MergeUI.jobs.some(j => j.name === 'e.mp4' && j.state === 'canceled'));
    assert.deepEqual(await page.evaluate(() => window.uploadStarts), ['a', 'd'], 'a canceled job never starts the overwrite');
    assert.deepEqual(puts.sort(), ['a', 'd']);
    assert.equal(await page.evaluate(() => gallery.intro.e), undefined);
    assert.equal(await page.evaluate(() => items.find(f => f.id === 'e').size), '900');
    assert.match(await page.locator('#mergePanel').textContent(), /원본은 그대로예요/);
    await page.screenshot({ path: path.join(root, 'tests', 'auto-thumb-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('auto-thumb-browser: ok');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
