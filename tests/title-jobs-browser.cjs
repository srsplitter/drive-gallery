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
  const input=()=>page.getByRole('textbox',{name:'일괄 이름 변경',exact:true});
  const search=async q=>{await page.locator('#catbar .search').fill(q);await page.waitForTimeout(200);};
  const submit=async name=>{await input().fill(name);await input().press('Enter');return page.evaluate(()=>TitleEditor.getJobs().at(-1).id);};
  const cancel=id=>page.locator('#titleProgress .title-job[data-job-id="'+id+'"]').getByRole('button',{name:'제목 작업 '+id+' 취소',exact:true}).click();
  const settle=async name=>page.evaluate(name=>{
    const request=window.requests.find(r=>r.name===name&&!r.done);if(!request)throw Error('No request '+name);
    request.done=true;request.resolve({ok:true});
  },name);
  const started=async name=>page.waitForFunction(name=>window.requests.some(r=>r.name===name),name);
  const pending=async name=>page.waitForFunction(name=>window.requests.some(r=>r.name===name&&!r.done),name);
  const done=async id=>page.waitForFunction(id=>document.querySelector('#titleProgress .title-job[data-job-id="'+id+'"]').textContent.includes('완료'),id);
  try{
    await page.goto('https://gallery.test/');
    await page.evaluate(()=>{
      prefetchCandidates=()=>{};needsShare=()=>false;ensureWriteScope=async()=>true;flushSaves=async()=>pendingSaves.clear();
      window.requests=[];api=async(url,opts)=>new Promise(resolve=>window.requests.push({id:url.split('/').pop(),name:JSON.parse(opts.body).name,resolve,done:false}));
      gallery={videos:{},hidden:{},tags:{a:['set1'],b:['set1']},fav:{},hiddenCats:{},exUse:{},loved:{},tagKinds:{},marks:{},series:{},order:{},covers:{}};
      items=['a','b','c'].map(id=>({id,name:id+'.mp4',mimeType:'video/mp4'}));
      $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;currentView='title';setEditMode(false);renderGrid();
    });
    await search('set1');const first=await submit('First');await started('First1.mp4');
    assert.equal(await input().isDisabled(),false);
    await search('c.mp4');const second=await submit('Second');await started('Second.mp4');
    assert.equal(await page.evaluate(()=>window.requests.filter(r=>!r.done).length),2);
    await cancel(first);await settle('Second.mp4');await done(second);await settle('First1.mp4');
    await started('a.mp4');await settle('a.mp4');
    await page.waitForFunction(id=>{
      const n=document.querySelector('#titleProgress .title-job[data-job-id="'+id+'"]');return n.textContent.includes('취소')&&!n.querySelector('button:not(:disabled)');
    },first);
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.name==='First2.mp4')),false);
    assert.deepEqual(await page.evaluate(()=>items.map(f=>f.name)),['a.mp4','b.mp4','Second.mp4']);
    await page.evaluate(()=>{items[0].name='a.mp4';query='';renderGrid();});
    await search('a.mp4');const old=await submit('Old');await started('Old.mp4');
    const middle=await submit('Middle'),latest=await submit('Latest');await cancel(middle);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.name==='Latest.mp4')),false);
    await settle('Old.mp4');await done(old);await started('Latest.mp4');
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.name==='Middle.mp4')),false);
    await settle('Latest.mp4');await done(latest);assert.equal(await page.evaluate(()=>items[0].name),'Latest.mp4');
    await page.evaluate(()=>{
      items=[{id:'d',name:'d.mp4',mimeType:'video/mp4'},{id:'e',name:'e.mp4',mimeType:'video/mp4'}];gallery.tags={};query='';renderGrid();
      window.scopeCalls=0;ensureWriteScope=async()=>{window.scopeCalls++;return new Promise(resolve=>window.resolveScope=resolve);};
    });
    await search('d.mp4');const denied=await submit('Canceled');
    await search('e.mp4');const permitted=await submit('Permitted');
    assert.equal(await page.evaluate(()=>window.scopeCalls),1);
    await cancel(denied);await page.evaluate(()=>window.resolveScope(true));await started('Permitted.mp4');
    assert.equal(await page.evaluate(()=>window.requests.some(r=>r.name==='Canceled.mp4')),false);
    await settle('Permitted.mp4');await done(permitted);
    await page.evaluate(()=>{
      items=[{id:'r',name:'r.mp4',mimeType:'video/mp4'},{id:'s',name:'s.mp4',mimeType:'video/mp4'}];
      gallery.tags={r:['shared'],s:['shared']};query='';ensureWriteScope=async()=>true;renderGrid();
    });
    await search('shared');const earlier=await submit('Earlier');await started('Earlier1.mp4');await settle('Earlier1.mp4');await started('Earlier2.mp4');
    await search('Earlier1.mp4');const newer=await submit('Newer');await started('Newer.mp4');await settle('Newer.mp4');await done(newer);
    await cancel(earlier);await settle('Earlier2.mp4');await started('s.mp4');await settle('s.mp4');
    await page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='canceled',earlier);
    assert.deepEqual(await page.evaluate(()=>items.map(f=>f.name)),['Newer.mp4','s.mp4']);
    assert.equal(await page.evaluate(id=>TitleEditor.getJobs().find(j=>j.id===id).rollbackSkipped,earlier),1);
    await page.evaluate(()=>{
      items=[{id:'t',name:'t.mp4',mimeType:'video/mp4'},{id:'u',name:'u.mp4',mimeType:'video/mp4'}];
      gallery.tags={t:['retry'],u:['retry']};query='';renderGrid();
    });
    await search('retry');const retry=await submit('Retry');await started('Retry1.mp4');await cancel(retry);await settle('Retry1.mp4');await started('t.mp4');
    await page.evaluate(()=>{const r=window.requests.find(r=>r.name==='t.mp4'&&!r.done);r.done=true;r.resolve({ok:false,status:503});});
    await page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='restore-failed',retry);
    assert.equal(await page.evaluate(()=>items[0].name),'Retry1.mp4');
    await page.locator('#titleProgress .title-job[data-job-id="'+retry+'"]').getByRole('button',{name:'제목 작업 '+retry+' 복원 재시도',exact:true}).click();
    await page.waitForFunction(()=>window.requests.some(r=>r.name==='t.mp4'&&!r.done));await settle('t.mp4');
    await page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='canceled',retry);
    assert.equal(await page.evaluate(()=>items[0].name),'t.mp4');
    for(const reverse of [false,true]){
      await page.evaluate(()=>{
        items=['x','y','z'].map(id=>({id,name:id+'.mp4',mimeType:'video/mp4'}));
        gallery.tags={x:['groupA','groupB'],y:['groupA'],z:['groupB']};gallery.order={regular:{x:100,y:200,z:300}};query='';renderGrid();
      });
      const aName=reverse?'ReverseA':'CascadeA',bName=reverse?'ReverseB':'CascadeB';
      await search('groupA');const aJob=await submit(aName);await pending(aName+'1.mp4');await settle(aName+'1.mp4');await pending(aName+'2.mp4');
      await search('groupB');const bJob=await submit(bName);await pending(bName+'1.mp4');await settle(bName+'1.mp4');await pending(bName+'2.mp4');
      if(reverse){
        await cancel(bJob);await settle(bName+'2.mp4');await pending(aName+'1.mp4');await settle(aName+'1.mp4');await pending('z.mp4');await settle('z.mp4');
        await page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='canceled',bJob);
        await cancel(aJob);await settle(aName+'2.mp4');await pending('x.mp4');await settle('x.mp4');await pending('y.mp4');await settle('y.mp4');
      }else{
        await cancel(aJob);await settle(aName+'2.mp4');await pending('y.mp4');await settle('y.mp4');
        await page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='canceled',aJob);
        await cancel(bJob);await settle(bName+'2.mp4');await pending('x.mp4');await settle('x.mp4');await pending('z.mp4');await settle('z.mp4');
      }
      await page.waitForFunction(ids=>ids.every(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='canceled'),[aJob,bJob]);
      assert.deepEqual(await page.evaluate(()=>items.map(f=>f.name)),['x.mp4','y.mp4','z.mp4']);
    }
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);console.log('PASS concurrent disjoint jobs, unlocked inputs, immutable snapshots, cancel in-flight/pending, same-file ordering/canceled reservation, coalesced scope, mobile progress');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
