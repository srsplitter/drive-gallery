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
  const ids=()=>page.locator('#regularVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id));
  const card=id=>page.locator('#regularVideos .card[data-id="'+id+'"]');
  const before=async(source,target)=>{
    await card(source).dragTo(card(target),{targetPosition:{x:2,y:60}});
    await page.waitForTimeout(400);
  };
  try{
    await page.goto('https://gallery.test/');
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};needsShare=()=>false;token='fixture';tokenExp=Date.now()+3600000;
      window.savedChanges=[];flushSaves=async()=>{window.savedChanges.push(...pendingSaves);pendingSaves.clear();};
      gallery={videos:{a:{file:'keep-a'}},hidden:{},tags:{},fav:{},hiddenCats:{},exUse:{},loved:{},tagKinds:{},marks:{},series:{},order:{}};
      items=['a','b','c','d','e'].map(id=>({id,name:id+'.mp4',mimeType:'video/mp4',videoMediaMetadata:{durationMillis:'10000'}}));
      $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;setEditMode(false);renderGrid();
    });
    assert.deepEqual(await ids(),['a','b','c','d','e']);
    assert.equal(await card('d').getAttribute('draggable'),'false');
    await page.evaluate(()=>setEditMode(true));
    assert.equal(await card('d').getAttribute('draggable'),'true');
    await before('d','b');assert.deepEqual(await ids(),['a','d','b','c','e']);
    assert.equal(await page.locator('#viewer').evaluate(n=>n.open),false);
    const saved=await page.evaluate(()=>JSON.parse(JSON.stringify(gallery)));
    assert.ok(Object.keys(saved.order).length);
    const roundtrip=await page.evaluate(()=>{
      const data={order:{old:10},videos:{}};
      applyChanges(data,new Map([['o:zero',0],['o:negative',-50],['o:old',null]]));
      return data.order;
    });
    assert.deepEqual(roundtrip,{zero:0,negative:-50});
    await page.evaluate(data=>{gallery=data;setEditMode(false);renderGrid();},saved);
    assert.deepEqual(await ids(),['a','d','b','c','e']);
    await page.evaluate(()=>{items.push({id:'x',name:'ax.mp4',mimeType:'video/mp4'});renderGrid();});
    assert.deepEqual(await ids(),['a','d','x','b','c','e']);
    const orderWithNewVideo=await page.evaluate(()=>JSON.parse(JSON.stringify(gallery.order)));
    await page.evaluate(()=>{items=items.filter(f=>!['a','b','c'].includes(f.id));renderGrid();});
    assert.deepEqual(await ids(),['d','x','e']);
    assert.deepEqual(await page.evaluate(()=>gallery.order),orderWithNewVideo);
    await page.evaluate(()=>{items.push({id:'z',name:'z.mp4',mimeType:'video/mp4'});renderGrid();});
    assert.deepEqual(await ids(),['d','x','e','z']);
    await page.evaluate(data=>{
      gallery=data;gallery.order={};gallery.series={s:{name:'시리즈',createdAt:'fixture',videoIds:['b','c']}};
      items=['a','b','c','d','e'].map(id=>({id,name:id+'.mp4',mimeType:'video/mp4'}));setEditMode(true);renderGrid();
    },saved);
    await before('d','c');
    assert.deepEqual(await page.evaluate(()=>gallery.series.s.videoIds),['b','d','c']);
    assert.equal(await page.evaluate(()=>gallery.series.s.name),'시리즈');
    assert.deepEqual(await ids(),['a','b','d','c','e']);
    await before('c','a');
    assert.deepEqual(await page.evaluate(()=>gallery.series.s.videoIds),['b','d','c']);
    assert.deepEqual(await ids(),['b','d','c','a','e']);
    await page.evaluate(()=>{gallery.loved={a:true,e:true};renderGrid();});
    const regular=await ids();
    await page.locator('#favoriteVideos .card[data-id="e"]').dragTo(page.locator('#favoriteVideos .card[data-id="a"]'),{targetPosition:{x:2,y:60}});
    await page.waitForTimeout(400);
    assert.deepEqual(await page.locator('#favoriteVideos .card').evaluateAll(ns=>ns.map(n=>n.dataset.id)),['e','a']);
    assert.deepEqual(await ids(),regular);
    await page.evaluate(()=>setEditMode(false));
    assert.equal(await card('a').getAttribute('draggable'),'false');
    await card('a').locator('.thumb').click();assert.equal(await page.locator('#viewer').evaluate(n=>n.open),true);
    await page.locator('#vClose').click();
    await page.evaluate(()=>{setEditMode(true);gallery.hidden.e=true;query='a';renderGrid();});
    assert.deepEqual(await ids(),['a']);
    const seriesBeforeRestore=await page.evaluate(()=>JSON.parse(JSON.stringify(gallery.series)));
    await page.getByRole('button',{name:'자동 정렬로 복원',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>gallery.order),{});
    assert.deepEqual(await page.evaluate(()=>gallery.series),seriesBeforeRestore);
    assert.deepEqual(await ids(),['a']);
    await page.evaluate(()=>{query='';renderGrid();});
    assert.deepEqual(await ids(),['a','b','d','c']);
    assert.equal(await page.evaluate(()=>gallery.videos.a.file),'keep-a');
    assert.deepEqual(errors,[]);
    console.log('PASS physical drag, edit gating, persisted ranks, deleted neighbors, new videos, series insertion/block movement, independent favorites, ordinary click');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
