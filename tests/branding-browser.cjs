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
  const geometry=()=>page.evaluate(()=>({header:document.querySelector('header').getBoundingClientRect().top,bottom:document.querySelector('header').getBoundingClientRect().bottom,nav:document.querySelector('#catbar').getBoundingClientRect().top}));
  try{
    await page.goto('https://gallery.test/');assert.equal(await page.title(),'갤러리');
    assert.ok((await page.locator('#siteLogo').textContent()).includes('🍑'));assert.ok((await page.locator('#siteLogo').textContent()).includes('갤러리'));
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};window.originalFlush=flushSaves;window.savedChanges=[];flushSaves=async()=>{window.savedChanges.push(...pendingSaves);pendingSaves.clear();};
      gallery={videos:{},hidden:{},tags:{},fav:{},hiddenCats:{},exUse:{},loved:{},tagKinds:{},marks:{},series:{},order:{},covers:{},settings:{}};
      items=Array.from({length:40},(_,i)=>({id:'v'+i,name:'video'+i+'.mp4',mimeType:'video/mp4'}));
      token='fixture';tokenExp=Date.now()+3600000;$('#setup').hidden=true;$('#authBtn').hidden=false;$('#editBtn').hidden=false;setEditMode(false);renderGrid();
    });
    await page.evaluate(()=>scrollTo(0,650));await page.waitForTimeout(100);
    let g=await geometry();assert.ok(Math.abs(g.header)<1&&Math.abs(g.nav-g.bottom)<2);
    await page.evaluate(()=>{const p=document.querySelector('#titleProgress');p.hidden=false;p.textContent='진행 중 작업 '.repeat(60);});await page.waitForTimeout(100);
    g=await geometry();assert.ok(Math.abs(g.nav-g.bottom)<2);
    await page.evaluate(()=>{document.querySelector('#titleProgress').hidden=true;scrollTo(0,0);});
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;c.getContext('2d').fillRect(0,0,40,20);return c.toDataURL().split(',')[1];});
    const chooser=page.waitForEvent('filechooser');await page.locator('#siteLogo').click();
    await (await chooser).setFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForFunction(()=>!!gallery.settings.icon);
    const value=await page.evaluate(()=>gallery.settings.icon);
    assert.ok(value.startsWith('data:image/png;base64,'));
    assert.equal(await page.locator('#brandIcon img').getAttribute('src'),value);
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),value);
    assert.ok(await page.evaluate(()=>window.savedChanges.some(([k])=>k==='u:icon')));
    const dimensions=await page.evaluate(async()=>{const img=new Image();img.src=gallery.settings.icon;await img.decode();return [img.naturalWidth,img.naturalHeight];});
    assert.deepEqual(dimensions,[256,256]);
    await page.evaluate(value=>{const data={settings:{},videos:{}};applyChanges(data,new Map([['u:icon',value]]));window.roundtrip=data.settings.icon;Branding.apply(null);Branding.apply(data.settings.icon);},value);
    assert.equal(await page.evaluate(()=>window.roundtrip),value);
    assert.equal(await page.locator('#brandIcon img').count(),1);
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,650));await page.waitForTimeout(100);
    g=await geometry();assert.ok(g.header<0&&Math.abs(g.nav)<2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.evaluate(()=>{
      pendingSaves.set('u:icon',gallery.settings.icon);showLoggedOut();
      token='account-b';gallery={videos:{},settings:{}};applyChanges(gallery,pendingSaves);
    });
    assert.equal(await page.evaluate(()=>gallery.settings.icon),undefined);
    await page.evaluate(value=>{
      token='account-a';pendingSaves.set('u:icon',value);window.accountWrites=[];
      readRemote=async()=>new Promise(resolve=>window.resolveOldRead=resolve);
      api=async(...args)=>{window.accountWrites.push(args);throw Error('Unexpected write');};
      window.oldSave=window.originalFlush();
    },value);
    await page.waitForFunction(()=>typeof window.resolveOldRead==='function');
    await page.evaluate(async()=>{
      showLoggedOut();token='account-b';gallery={videos:{},settings:{}};
      window.resolveOldRead({fileId:'account-a-metadata',data:{videos:{},settings:{}}});await window.oldSave;
    });
    assert.equal(await page.evaluate(()=>window.accountWrites.length),0);
    assert.equal(await page.evaluate(()=>pendingSaves.has('u:icon')),false);
    assert.equal(await page.evaluate(()=>gallery.settings.icon),undefined);
    assert.equal(await page.locator('#brandIcon').textContent(),'🍑');
    assert.ok((await page.locator('link[rel="icon"]').getAttribute('href')).endsWith('favicon.svg'));
    await page.evaluate(value=>{
      token='account-a';pendingSaves.set('u:icon',value);window.resumeWrites=[];let reads=0;
      readRemote=async()=>++reads===1?new Promise(resolve=>window.resolvePausedRead=resolve):{fileId:'account-b-metadata',data:{videos:{},settings:{}}};
      api=async(url,options)=>{window.resumeWrites.push({url,body:JSON.parse(options.body)});return {json:async()=>({md5Checksum:'account-b-md5'})};};
      flushSaves=window.originalFlush;window.pausedSave=flushSaves();
    },value);
    await page.waitForFunction(()=>typeof window.resolvePausedRead==='function');
    await page.evaluate(async()=>{
      showLoggedOut();token='account-b';gallery={videos:{},settings:{}};
      const c=document.createElement('canvas');c.width=c.height=2;c.getContext('2d').fillStyle='red';c.getContext('2d').fillRect(0,0,2,2);
      window.bIcon=c.toDataURL();gallery.settings.icon=window.bIcon;pendingSaves.set('u:icon',window.bIcon);await flushSaves();
      window.resolvePausedRead({fileId:'account-a-metadata',data:{videos:{},settings:{}}});await window.pausedSave;
    });
    await page.waitForFunction(()=>window.resumeWrites.length===1&&!pendingSaves.has('u:icon'));
    assert.ok((await page.evaluate(()=>window.resumeWrites[0].url)).includes('account-b-metadata'));
    assert.equal(await page.evaluate(()=>window.resumeWrites[0].body.settings.icon),await page.evaluate(()=>window.bIcon));
    assert.deepEqual(errors,[]);console.log('PASS peach brand, desktop shared sticky/dynamic height, mobile behavior, logo file chooser, 256px PNG/favicon, settings persistence, logout reset');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
