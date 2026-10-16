const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='gallery.test')return route.abort();
    const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});
  });
  const ids=()=>page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id));
  try{
    await page.goto('https://gallery.test/');
    assert.equal(await page.locator('#autoSortBtn').isVisible(),false);
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};needsShare=()=>false;token='fixture';tokenExp=Date.now()+3600000;
      window.savedChanges=[];flushSaves=async()=>{window.savedChanges.push(...pendingSaves);pendingSaves.clear();};
      gallery={videos:{a:{file:'keep-thumb'}},hidden:{},tags:{a:['G','C','A'],b:['G','C','B'],c:['G','C','A']},
        fav:{},hiddenCats:{},exUse:{},loved:{a:true,c:true},tagKinds:{G:'genre',C:'character',A:'category',B:'category'},marks:{},series:{},
        order:{regular:{c:1,b:2,a:3},favorites:{c:1,a:2}}};
      items=[{id:'a',name:'마리오1.mp4'},{id:'b',name:'마리오2.mp4'},{id:'c',name:'마리오10.mp4'}].map(f=>({...f,mimeType:'video/mp4'}));
      $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;setEditMode(false);renderGrid();
      randomRank=new Map([['b',0],['c',1],['a',2]]);filters.tags=['G'];renderGrid();
    });
    assert.deepEqual(await ids(),['b','c','a']);
    assert.equal(await page.locator('#autoSortBtn').isVisible(),true);
    const before=await page.evaluate(()=>JSON.stringify({tags:gallery.tags,videos:gallery.videos,series:gallery.series,favorites:gallery.order.favorites}));
    await page.getByRole('button',{name:'자동 정렬',exact:true}).click();
    assert.deepEqual(await ids(),['a','b','c']);
    assert.deepEqual(await page.evaluate(()=>filters.tags),['G']);
    assert.equal(await page.evaluate(()=>randomRank),null);
    assert.equal(await page.evaluate(()=>Object.hasOwn(gallery.order,'regular')),false);
    assert.equal(await page.evaluate(()=>JSON.stringify({tags:gallery.tags,videos:gallery.videos,series:gallery.series,favorites:gallery.order.favorites})),before);
    assert.deepEqual(await page.locator('#favoriteVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)),['c','a']);
    assert.equal(await page.evaluate(()=>window.savedChanges.some(([k,v])=>k==='o:regular'&&v===null)),true);
    await page.evaluate(()=>{gallery=JSON.parse(JSON.stringify(gallery));renderGrid();});
    assert.deepEqual(await ids(),['a','b','c']);
    await page.evaluate(()=>{gallery.series={s:{name:'saved',videoIds:['c','a']}};renderGrid();});
    await page.getByRole('button',{name:'자동 정렬',exact:true}).click();
    assert.deepEqual(await ids(),['c','a','b']);
    assert.deepEqual(await page.evaluate(()=>gallery.series.s.videoIds),['c','a']);
    await page.locator('#catbar').getByRole('button',{name:'태그',exact:true}).click();
    assert.equal(await page.locator('#autoSortBtn').isVisible(),false);
    await page.locator('#catbar').getByRole('button',{name:'태그',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    const box=await page.locator('#autoSortBtn').boundingBox();
    assert.ok(box&&Math.abs(box.x+box.width-(390-16))<1&&Math.abs(box.y+box.height-(844-16))<1);
    await page.evaluate(()=>{setEditMode(true);SeriesUI.start();renderGrid();});
    assert.equal(await page.locator('#autoSortBtn').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS floating auto sort, numeric titles, manual reset/persistence, random reset, filter/favorite/series preservation, mobile position and visibility');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
