// 독립 브라우저와 가짜 갤러리 데이터로 확인. 실제 구글 계정에는 접근하지 않는다.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'gallery.test') return route.abort();
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
    return route.fulfill({ contentType:file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', body:fs.readFileSync(file) });
  });
  try {
    await page.goto('http://gallery.test/');
    await page.evaluate(() => {
      prefetchCandidates = () => {};
      window.savedChanges = [];
      flushSaves = async () => { window.savedChanges.push(...pendingSaves); pendingSaves.clear(); };
      gallery = { videos: {}, hidden: {}, tags: { a:['게임','마리오','버섯'], b:['게임','루이지'], c:['영화'], d:[], e:['일반'] },
        fav: {}, hiddenCats: {}, exUse: {}, loved: { e:true }, tagKinds:{ '게임':'category', '영화':'category', '마리오':'character', '루이지':'character' }, marks:{} };
      items = ['a','b','c','d','e'].map(id => ({id, name: id + '.mp4', mimeType:'video/mp4', category:'old-folder', videoMediaMetadata:{durationMillis:'10000'}}));
      $('#setup').hidden = true; $('#editBtn').hidden = false; $('#authBtn').hidden = false;
      renderGrid();
    });
    assert.deepEqual(await page.locator('#grid .card').evaluateAll(ns => ns.map(n => n.dataset.id)), ['e','b','a','c','d']);
    assert.equal(await page.locator('.cat-title').count(), 0);
    assert.equal(await page.getByText('old-folder', {exact:true}).count(), 0);
    await page.screenshot({ path:path.join(root,'tests','gallery-desktop.png'), fullPage:true });
    assert.equal(await page.locator('.card.loved .love-badge').count(), 1);
    await page.locator('#catbar').getByRole('button', {name:'태그',exact:true}).click();
    assert.equal(await page.locator('#grid .card').count(), 0);
    assert.equal(await page.locator('#grid .pill').count(), 2);
    assert.equal(await page.locator('#grid .star').first().isVisible(), false);
    await page.evaluate(() => setEditMode(true));
    assert.equal(await page.locator('#grid .pen').count(), 2);
    assert.equal(await page.locator('#grid .bin').count(), 2);
    assert.equal(await page.locator('#directoryMemos textarea').count(), 2);
    const memo = page.locator('#directoryMemos .m-sec').filter({has:page.getByText('캐릭터(으)로 이동',{exact:true})});
    await memo.locator('textarea').fill('버섯');
    await memo.locator('textarea').press('Enter');
    assert.equal(await page.evaluate(() => gallery.tagKinds['버섯']), 'character');
    assert.equal(await page.evaluate(() => gallery.tags.a.includes('버섯')), true);
    await page.locator('#catbar').getByRole('button',{name:'캐릭터',exact:true}).click();
    assert.equal(await page.locator('#grid .pill').count(), 3);
    await page.locator('#grid .pill').filter({hasText:'버섯'}).click();
    assert.deepEqual(await page.locator('#grid .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)), ['a']);
    assert.equal(await page.locator('#catbar [aria-pressed="true"]').count(), 0);
    await page.evaluate(() => { filters=EMPTY_FILTERS(); renderGrid(); openViewer(items.find(f=>f.id==='a')); });
    await page.locator('#vStar').click();
    assert.equal(await page.evaluate(()=>gallery.marks.a),'star');
    assert.equal(await page.locator('.card[data-id="a"]').evaluate(n=>getComputedStyle(n.querySelector('.thumb'),'::after').borderColor),'rgb(87, 184, 120)');
    await page.locator('#vSquare').click();
    assert.equal(await page.evaluate(()=>gallery.marks.a),'square');
    await page.locator('#vHeart').click();
    assert.equal(await page.locator('.card[data-id="a"] .love-badge').count(),1);
    assert.equal(await page.locator('.card[data-id="a"]').evaluate(n=>getComputedStyle(n.querySelector('.thumb'),'::after').borderColor),'rgb(255, 79, 154)');
    await page.locator('#vClose').click();
    await page.evaluate(()=>setEditMode(false));
    await page.locator('#catbar').getByRole('button',{name:'카테고리',exact:true}).click();
    assert.equal(await page.locator('#directoryMemos').isVisible(),false);
    await page.evaluate(()=>{ setEditMode(true); openMenu(); });
    await page.evaluate(()=>setEditMode(false));
    assert.equal(await page.locator('#menu .pen').count(),0);
    assert.equal(await page.locator('#menu .bin').count(),0);
    assert.equal(await page.evaluate(()=>{toggleFav('게임');return !!gallery.fav['게임'];}),false);
    await page.evaluate(()=>closeMenu());
    await page.evaluate(()=>{
      openSearch();
      const input=$('#catbar input'); input.value='no-match'; input.dispatchEvent(new Event('input'));
      currentView='category'; renderGrid();
      [...$('#grid').querySelectorAll('.pill')].find(n=>n.textContent.includes('게임')).click();
    });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>query),'');
    assert.equal(await page.locator('#grid .card').count(),2);
    await page.locator('#catbar').getByRole('button',{name:'카테고리',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'tests','gallery-phone.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const roundtrip = await page.evaluate(()=>{
      const data={videos:{keep:{file:'existing-thumb'}},tags:{a:['게임']},tagKinds:{},marks:{}};
      applyChanges(data,new Map([['k:게임','category'],['m:a','star']]));
      return JSON.parse(JSON.stringify(data));
    });
    assert.equal(roundtrip.videos.keep.file,'existing-thumb');
    assert.equal(roundtrip.tagKinds['게임'],'category');
    assert.equal(roundtrip.marks.a,'star');
    assert.deepEqual(errors, []);
    console.log('PASS directories, edit gating, transfer, search, marks, mobile layout, persistence maps, no runtime errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
