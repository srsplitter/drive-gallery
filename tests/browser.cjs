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
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:''});
    return route.fulfill({ contentType:file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', body:fs.readFileSync(file) });
  });
  try {
    await page.goto('https://gallery.test/');
    await page.evaluate(() => {
      prefetchCandidates = () => {};
      needsShare = () => false; // 태그·목록 테스트에서 화면 공유 UI는 제외
      token='fixture';tokenExp=Date.now()+3600000;
      window.savedChanges = [];
      flushSaves = async () => { window.savedChanges.push(...pendingSaves); pendingSaves.clear(); };
      gallery = { videos: {}, hidden: {}, tags: { a:['게임','마리오','버섯'], b:['게임','루이지'], c:['영화'], d:[], e:['일반'] },
        fav: {}, hiddenCats: {}, exUse: {}, loved: { e:true }, tagKinds:{ '게임':'category', '영화':'category', '마리오':'character', '루이지':'character' }, marks:{}, series:{} };
      items = ['a','b','c','d','e'].map(id => ({id, name: id + '.mp4', mimeType:'video/mp4', category:'old-folder', videoMediaMetadata:{durationMillis:'10000'}}));
      $('#setup').hidden = true; $('#editBtn').hidden = false; $('#authBtn').hidden = false;
      renderGrid();
    });
    assert.deepEqual(await page.locator('#regularVideos .card').evaluateAll(ns => ns.map(n => n.dataset.id)), ['b','a','c','e','d']);
    assert.deepEqual(await page.locator('#favoriteVideos .card').evaluateAll(ns => ns.map(n => n.dataset.id)), ['e']);
    assert.equal(await page.locator('#grid .card').count(),6);
    assert.deepEqual(await page.evaluate(()=>shown.map(f=>f.id)),['b','a','c','e','d']);
    assert.ok((await page.locator('#bulkTag button').textContent()).includes('5'));
    await page.locator('#favoriteVideos .card[data-id="e"] .thumb').click();
    await page.getByRole('button',{name:'이전 영상',exact:true}).click();assert.equal(await page.locator('#vTitle').textContent(),'c.mp4');
    await page.getByRole('button',{name:'다음 영상',exact:true}).click();assert.equal(await page.locator('#vTitle').textContent(),'e.mp4');
    await page.locator('#vClose').click();
    assert.equal(await page.locator('.cat-title').count(), 0);
    assert.equal(await page.getByText('old-folder', {exact:true}).count(), 0);
    await page.screenshot({ path:path.join(root,'tests','gallery-desktop.png'), fullPage:true });
    assert.equal(await page.locator('.card.loved .love-badge').count(), 2);
    await page.locator('#catbar').getByRole('button', {name:'태그',exact:true}).click();
    assert.equal(await page.locator('#grid .card').count(), 0);
    assert.equal(await page.locator('#grid .pill').count(), 2);
    assert.equal(await page.locator('#grid .star').first().isVisible(), false);
    await page.evaluate(() => setEditMode(true));
    assert.equal(await page.locator('#grid .pen').count(), 2);
    assert.equal(await page.locator('#grid .bin').count(), 2);
    assert.equal(await page.locator('#directoryMemos textarea').count(), 3);
    const memo = page.locator('#directoryMemos .m-sec').filter({has:page.getByText('캐릭터(으)로 이동',{exact:true})});
    await memo.locator('textarea').fill('버섯');
    await memo.locator('textarea').press('Enter');
    assert.equal(await page.evaluate(() => gallery.tagKinds['버섯']), 'character');
    assert.equal(await page.evaluate(() => gallery.tags.a.includes('버섯')), true);
    await page.locator('#catbar').getByRole('button',{name:'캐릭터',exact:true}).click();
    assert.equal(await page.locator('#grid .pill').count(), 3);
    await page.evaluate(()=>setEditMode(false));
    await page.locator('#grid .pill').filter({hasText:'버섯'}).click();
    assert.deepEqual(await page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)), ['a']);
    assert.equal(await page.locator('#catbar [aria-pressed="true"]').count(), 0);
    await page.evaluate(() => { setEditMode(true); filters=EMPTY_FILTERS(); renderGrid(); openViewer(items.find(f=>f.id==='a')); });
    await page.locator('#vStar').click();
    assert.equal(await page.evaluate(()=>gallery.marks.a),'star');
    assert.equal(await page.locator('#regularVideos .card[data-id="a"]').evaluate(n=>getComputedStyle(n.querySelector('.thumb'),'::after').borderColor),'rgb(87, 184, 120)');
    await page.locator('#vSquare').click();
    assert.equal(await page.evaluate(()=>gallery.marks.a),'square');
    await page.locator('#vHeart').click();
    assert.equal(await page.locator('#regularVideos .card[data-id="a"] .love-badge').count(),1);
    assert.equal(await page.locator('#regularVideos .card[data-id="a"]').evaluate(n=>getComputedStyle(n.querySelector('.thumb'),'::after').borderColor),'rgb(255, 79, 154)');
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
    assert.equal(await page.locator('#regularVideos .card').count(),2);
    await page.locator('#catbar').getByRole('button',{name:'카테고리',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,'tests','gallery-phone.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const roundtrip = await page.evaluate(()=>{
      const data={videos:{keep:{file:'existing-thumb'}},tags:{a:['게임']},tagKinds:{},marks:{}};
      applyChanges(data,new Map([['k:게임','category'],['k:모험','genre'],['m:a','star']]));
      return JSON.parse(JSON.stringify(data));
    });
    assert.equal(roundtrip.videos.keep.file,'existing-thumb');
    assert.equal(roundtrip.tagKinds['게임'],'category');
    assert.equal(roundtrip.tagKinds['모험'],'genre');
    assert.equal(roundtrip.marks.a,'star');
    for (const source of ['normal','character','category','genre']) {
      await page.evaluate(source=>{
        gallery.tags={a:['첫째','둘째','셋째']}; gallery.tagKinds={};
        if(source!=='normal') for(const t of gallery.tags.a) gallery.tagKinds[t]=source;
        filters=EMPTY_FILTERS(); query=''; currentView=source; setEditMode(true); renderGrid();
      },source);
      const first=page.locator('#directoryMemos textarea').nth(0);
      const other=page.locator('#directoryMemos textarea').nth(1);
      const last=page.locator('#directoryMemos textarea').nth(2);
      assert.equal(await page.locator('#directoryMemos textarea').count(),3);
      await first.focus(); await first.press('Tab');
      assert.equal(await other.evaluate(n=>n===document.activeElement),true,source+' tab next');
      await other.press('Tab');assert.equal(await last.evaluate(n=>n===document.activeElement),true);
      await last.press('Tab');assert.equal(await first.evaluate(n=>n===document.activeElement),true,source+' tab wrap');
      await first.press('Shift+Tab');assert.equal(await last.evaluate(n=>n===document.activeElement),true,source+' shift tab wrap');
      await other.fill('미전송');
      await first.fill('첫째'); await first.press('Enter');
      assert.equal(await first.evaluate(n=>n===document.activeElement),true,source+' focus after Enter');
      assert.equal(await first.inputValue(),'');
      assert.equal(await other.inputValue(),'미전송');
      await first.fill('둘째'); await first.press('Enter');
      assert.equal(await first.evaluate(n=>n===document.activeElement),true);
      await first.fill('셋째'); await page.locator('#directoryMemos .m-sec').nth(0).getByRole('button',{name:'전송'}).click();
      assert.equal(await first.evaluate(n=>n===document.activeElement),true,source+' focus after Send');
      assert.equal(await other.inputValue(),'미전송');
    }
    const colors=await page.evaluate(()=>{
      gallery.tags={a:['카테고리색','캐릭터색','일반색','장르색']}; gallery.tagKinds={'카테고리색':'category','캐릭터색':'character','장르색':'genre'};
      currentView='';renderGrid();
      const wrap=document.createElement('div');document.body.append(wrap);
      const style=n=>{const s=getComputedStyle(n);return {border:s.borderColor,bg:s.backgroundColor,color:s.color};};
      const pills=gallery.tags.a.map(t=>{const n=pill(t,1);wrap.append(n);return style(n);});
      const chips=[...document.querySelector('.card[data-id="a"] .card-tags').children].map(style);
      wrap.remove(); return {pills,chips};
    });
    assert.equal(colors.pills[0].border,'rgb(255, 79, 154)');
    assert.equal(colors.pills[1].border,'rgb(87, 184, 120)');
    assert.equal(colors.pills[3].border,'rgb(255, 197, 49)');
    assert.equal(colors.pills[3].bg,colors.pills[2].bg);assert.equal(colors.pills[3].color,colors.pills[2].color);
    assert.equal(colors.pills[0].bg,colors.pills[2].bg);assert.equal(colors.pills[1].color,colors.pills[2].color);
    assert.ok(colors.chips.some(s=>s.border==='rgb(255, 79, 154)'));
    assert.ok(colors.chips.some(s=>s.border==='rgb(87, 184, 120)'));
    assert.ok(colors.chips.some(s=>s.border==='rgb(255, 197, 49)'));
    const chipOrder=await page.evaluate(()=>{
      gallery.tags={a:['일반','모험','게임','마리오','루이지'],b:['일반','게임','루이지'],c:['일반']};
      gallery.tagKinds={모험:'genre',게임:'category',마리오:'character',루이지:'character'};
      currentView='';filters=EMPTY_FILTERS();query='';renderGrid();
      return [...document.querySelector('.card[data-id="a"] .card-tags').children].map(n=>n.textContent);
    });
    assert.deepEqual(chipOrder,['게임','모험','루이지','마리오','일반']);
    await page.locator('#catbar').getByRole('button',{name:'장르',exact:true}).click();
    assert.equal(await page.locator('#grid .pill').count(),1);
    await page.evaluate(()=>setEditMode(false));
    await page.locator('#grid .pill').filter({hasText:'모험'}).click();
    assert.deepEqual(await page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)),['a']);
    await page.locator('#catbar').getByRole('button',{name:'태그',exact:true}).click();
    await page.evaluate(()=>setEditMode(true));
    const genreMemo=page.locator('#directoryMemos .m-sec').filter({has:page.getByText('장르(으)로 이동',{exact:true})});
    await genreMemo.locator('textarea').fill('일반');await genreMemo.locator('textarea').press('Enter');
    assert.equal(await page.evaluate(()=>gallery.tagKinds['일반']),'genre');
    for (const kind of ['normal','character','category','genre']) {
      await page.evaluate(kind=>{
        gallery.tags={a:['찾기대상','제외대상']};gallery.tagKinds={};
        if(kind!=='normal') for(const t of gallery.tags.a)gallery.tagKinds[t]=kind;
        currentView=kind;query='';searchOpen=false;filters=EMPTY_FILTERS();renderGrid();
      },kind);
      await page.locator('#catbar').getByRole('button',{name:'🔍',exact:true}).click();
      assert.equal(await page.evaluate(()=>currentView),kind,'search keeps '+kind);
      await page.locator('#catbar input').fill('찾기');await page.waitForTimeout(200);
      assert.equal(await page.locator('#grid .pill').count(),1);
      assert.equal(await page.locator('#grid .card').count(),0);
      await page.locator('#catbar input').fill('없는이름');await page.waitForTimeout(200);
      assert.equal(await page.locator('#grid .pill').count(),0);
      await page.locator('#catbar input').press('Escape');
      assert.equal(await page.evaluate(()=>currentView),kind);
      assert.equal(await page.locator('#grid .pill').count(),2);
    }
    await page.evaluate(()=>{
      gallery.tags={a:['MixedCASE'],b:['MixedCASE']};gallery.tagKinds={MixedCASE:'genre'};
      currentView='';query='';searchOpen=false;filters=EMPTY_FILTERS();renderGrid();
    });
    await page.locator('#catbar').getByRole('button',{name:'🔍',exact:true}).click();
    await page.locator('#catbar input').fill('mixed');
    await page.locator('#catbar').getByRole('button',{name:'장르',exact:true}).click();
    assert.equal(await page.evaluate(()=>query),'mixed');
    assert.equal(await page.locator('#grid .pill').count(),1);
    assert.ok((await page.locator('#catbar input').getAttribute('placeholder')).includes('장르'));
    await page.evaluate(()=>setEditMode(false));
    await page.locator('#grid .pill').click();
    assert.equal(await page.evaluate(()=>query),'');
    assert.equal(await page.locator('#regularVideos .card').count(),2);
    await page.evaluate(()=>{filters=EMPTY_FILTERS();renderGrid();});
    await page.locator('#catbar').getByRole('button',{name:'🔍',exact:true}).click();
    await page.locator('#catbar input').fill('b.mp4');await page.waitForTimeout(200);
    assert.deepEqual(await page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)),['b']);
    assert.equal(await page.locator('#favoriteVideos').count(),0);
    await page.locator('#catbar input').press('Escape');
    await page.setViewportSize({width:1280,height:900});
    await page.evaluate(()=>{
      const thumb=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);return {thumb:c.toDataURL(),at:'test'};};
      gallery.videos={a:thumb(180,480,'#385c9f'),b:thumb(480,180,'#40663c'),c:thumb(320,320,'#956849')};
      gallery.tags={a:['짧은태그'],b:Array.from({length:12},(_,i)=>'아주긴태그'+i),c:[]};
      gallery.loved={a:true};gallery.marks={b:'star',c:'square'};
      items=items.filter(f=>['a','b','c'].includes(f.id));
      currentView='';filters=EMPTY_FILTERS();query='';setEditMode(false);renderGrid();
    });
    await page.locator('#grid .thumb img').evaluateAll(ns=>Promise.all(ns.map(n=>n.decode())));
    const boxes=await page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>{
      const c=n.getBoundingClientRect(),t=n.querySelector('.thumb').getBoundingClientRect();
      return {top:t.top,width:t.width,height:t.height,gap:t.top-c.top,fit:getComputedStyle(n.querySelector('img')).objectFit};
    }));
    for(const box of boxes){assert.ok(Math.abs(box.top-boxes[0].top)<1);assert.ok(Math.abs(box.height-boxes[0].height)<1);assert.ok(box.gap<=1.1);assert.ok(Math.abs(box.width/box.height-16/9)<0.01);assert.equal(box.fit,'cover');}
    await page.waitForTimeout(300); // 썸네일 표시 전환이 끝난 뒤 시각 확인
    await page.screenshot({path:path.join(root,'tests','thumb-layout.png'),fullPage:true});
    assert.deepEqual(errors, []);
    console.log('PASS directories, edit gating, transfer, search, marks, mobile layout, persistence maps, memo repeated entry/focus/drafts, border-only kind colors, no runtime errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
