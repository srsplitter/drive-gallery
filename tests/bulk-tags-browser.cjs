const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='gallery.test')return route.abort();
    const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});
  });
  const removal=()=>page.getByLabel('보이는 영상에서 태그 제거',{exact:true});
  const removeButton=()=>page.locator('#bulkTag button').filter({hasText:'에서 제거'});
  const addition=()=>page.locator('#bulkTag textarea').first();
  try{
    await page.goto('https://gallery.test/');
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};window.savedChanges=[];flushSaves=async()=>{window.savedChanges.push(...pendingSaves);pendingSaves.clear();};
      gallery={videos:{a:{file:'keep-thumb'}},hidden:{},tags:{a:['게임','Mario','모험','빨강','남김'],b:['게임','Mario','모험','빨강','다른'],c:['게임'],d:['영화','Mario','모험']},fav:{},hiddenCats:{},exUse:{},loved:{a:true},tagKinds:{게임:'category',영화:'category',Mario:'character',모험:'genre'},marks:{},series:{},order:{},covers:{}};
      items=['a','b','c','d'].map(id=>({id,name:id+'.mp4',mimeType:'video/mp4'}));
      $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;filters={...EMPTY_FILTERS(),tags:['게임']};setEditMode(true);renderGrid();$('#editNote').hidden=true;
    });
    assert.equal(await page.locator('#bulkTag textarea').count(),2);
    assert.equal(await page.evaluate(()=>document.querySelector('#bulkTag').getBoundingClientRect().top-document.querySelector('#grid').getBoundingClientRect().bottom>=24),true);
    const rects=await page.locator('#bulkTag textarea').evaluateAll(ns=>ns.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
    assert.ok(Math.abs(rects[0].y-rects[1].y)<2&&rects[1].x>rects[0].x);
    await addition().fill('모험');await removal().fill('Mar, 모');await removal().press('Enter');
    assert.deepEqual(await page.evaluate(()=>gallery.tags.a),['게임','Mario','모험','빨강','남김']);
    await removal().fill('게임, Mario, 모험, 빨강');await removal().press('Enter');
    assert.deepEqual(await page.evaluate(()=>gallery.tags),{a:['남김'],b:['다른'],d:['영화','Mario','모험']});
    assert.equal(await page.evaluate(()=>shown.length),0);
    assert.equal(await addition().inputValue(),'모험');
    assert.equal(await removal().evaluate(n=>n===document.activeElement),true);
    assert.equal(await page.evaluate(()=>gallery.tagKinds.Mario),'character');
    assert.equal(await page.evaluate(()=>gallery.videos.a.file),'keep-thumb');
    assert.ok(await page.evaluate(()=>window.savedChanges.some(([key,value])=>key==='t:c'&&value===null)));
    await page.evaluate(()=>{filters=EMPTY_FILTERS();renderGrid();});
    await addition().press('Enter');
    assert.equal(await page.evaluate(()=>items.every(f=>tagsOf(f).includes('모험'))),true);
    await page.evaluate(()=>{gallery.tags.a=['Final Fantasy','Final','Fantasy'];renderGrid();});
    await removal().fill('Final Fantasy');
    assert.equal(await removal().inputValue(),'Final Fantasy');
    await removal().press('Enter');
    assert.deepEqual(await page.evaluate(()=>gallery.tags.a),['Final','Fantasy']);
    await page.evaluate(()=>setEditMode(false));assert.equal(await page.locator('#bulkTag').isVisible(),false);
    const before=await page.evaluate(()=>JSON.stringify(gallery.tags));
    await removal().evaluate(n=>n.value='모험');await removeButton().evaluate(n=>n.click());
    assert.equal(await page.evaluate(()=>JSON.stringify(gallery.tags)),before);
    await page.evaluate(()=>{setEditMode(true);$('#editNote').hidden=true;});await page.setViewportSize({width:390,height:844});
    const mobile=await page.locator('#bulkTag textarea').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().y));assert.ok(mobile[1]>mobile[0]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);console.log('PASS bulk add/remove spacing, snapshot filter removal, exact names all kinds, outside videos preserved, null persistence, drafts/focus, OFF guard, mobile stack');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
