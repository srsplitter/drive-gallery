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
  const tiles=()=>page.locator('.tag-directory > .directory-item');
  const geometry=()=>page.evaluate(()=>{
    const panel=document.querySelector('.directory-cover-row');
    const key=panel.dataset.coverKey;
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right,bottom:r.bottom};};
    const entries=[...document.querySelectorAll('.tag-directory > .directory-item')];
    const active=entries.find(n=>n.dataset.coverKey===key),a=rect(active);
    const same=entries.filter(n=>Math.abs(rect(n).y-a.y)<1);
    const later=entries.filter(n=>rect(n).y>a.y+1);
    return {panel:rect(panel),active:a,row:same.map(rect),later:later.map(rect),container:rect(panel.parentElement),choices:rect(panel.querySelector('.cover-candidates'))};
  });
  const validate=async()=>{
    const g=await geometry();
    assert.ok(g.panel.y>=Math.max(...g.row.map(r=>r.bottom))-1);
    assert.ok(g.later.every(r=>r.y>=g.panel.bottom-1));
    assert.ok(g.choices.x>=g.container.x-1&&g.choices.right<=g.container.right+1);
    assert.ok(Math.abs(g.panel.width-g.container.width)<2);
  };
  try{
    await page.goto('https://gallery.test/');
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};flushSaves=async()=>pendingSaves.clear();
      const tags=Array.from({length:30},(_,i)=>String(i).padStart(2,'0')+(i%3?'짧음':'아주아주긴이름'.repeat(7)));
      gallery={videos:{},hidden:{},tags:{},fav:{},hiddenCats:{},exUse:{},loved:{},tagKinds:{},marks:{},series:{},order:{},covers:{}};
      items=tags.map((t,i)=>{const id='v'+i;gallery.tags[id]=[t];gallery.tagKinds[t]='category';return {id,name:id+'.mp4',mimeType:'video/mp4'};});
      for(const f of items)if(!gallery.tags[f.id].includes(tags[4]))gallery.tags[f.id].push(tags[4]);
      $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;currentView='category';setEditMode(true);renderGrid();$('#editNote').hidden=true;
    });
    const widths=await tiles().evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().width));
    assert.ok(Math.max(...widths)-Math.min(...widths)<2);
    const before=await tiles().nth(4).boundingBox();
    await tiles().nth(4).locator('.cover-thumb').click();
    const after=await tiles().nth(4).boundingBox();assert.ok(Math.abs(before.y-after.y)<1);
    await validate();
    await tiles().nth(6).locator('.cover-thumb').click();
    assert.equal(await page.locator('.directory-cover-row').count(),1);await validate();
    await page.screenshot({path:path.join(root,'tests','directory-row-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);await validate();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await tiles().nth(1).locator('.cover-thumb').click();await validate();
    assert.equal(await page.locator('.directory-cover-row').count(),1);
    await page.screenshot({path:path.join(root,'tests','directory-row-phone.png'),fullPage:true});
    await tiles().nth(1).locator('.cover-thumb').click();assert.equal(await page.locator('.directory-cover-row').count(),0);
    assert.deepEqual(errors,[]);console.log('PASS uniform tags, stable whole-row expansion, single open panel, centered bounded choices, resize/mobile, collapse');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
