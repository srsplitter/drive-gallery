const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const mario=()=>Array.from({length:5},(_,i)=>['m'+(i+1),'Mario'+(i+1)+'.mp4']);
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  let failures=0;
  async function scenario(label,files,test){
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());if(u.hostname!=='gallery.test')return route.abort();
      const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':'text/html; charset=utf-8',body:fs.readFileSync(file)});
    });
    try{
      await page.goto('https://gallery.test/');
      await page.evaluate(files=>{
        prefetchCandidates=()=>{};needsShare=()=>false;ensureWriteScope=async()=>true;flushSaves=async()=>pendingSaves.clear();
        gallery={videos:{},hidden:{},tags:{},fav:{},hiddenCats:{},exUse:{},loved:{},tagKinds:{},marks:{},series:{},order:{},covers:{}};
        items=files.map(([id,name])=>({id,name,mimeType:'video/mp4'}));
        window.drive=Object.fromEntries(files);window.requests=[];window.violations=[];window.calls=[];
        window.base=name=>name.replace(/\.[^.]+$/u,'');
        window.check=()=>{
          for(const f of items)if(f.name!==window.drive[f.id])window.violations.push('optimistic '+f.id+': '+f.name+' != '+window.drive[f.id]);
        };
        api=(url,opts)=>{
          window.check();
          if(opts.method!=='PATCH')throw Error('Unexpected fake API method '+opts.method);
          const id=url.split('/').pop(),name=JSON.parse(opts.body).name;
          if(window.requests.some(r=>!r.done&&r.id===id))window.violations.push('overlapping PATCH '+id+' -> '+name);
          return new Promise(resolve=>window.requests.push({id,name,resolve,done:false}));
        };
        window.finish=(index,ok=true)=>{
          window.check();const r=window.requests[index];if(!r||r.done)throw Error('No pending request '+index);
          r.done=true;
          if(ok){
            const duplicate=Object.entries(window.drive).find(([id,name])=>id!==r.id&&window.base(name)===window.base(r.name));
            if(duplicate){window.violations.push('duplicate PATCH '+r.id+' -> '+r.name+' conflicts '+duplicate[0]);r.resolve({ok:false,status:409});return;}
            window.drive[r.id]=r.name;
          }
          r.resolve({ok,status:ok?200:503,json:async()=>({id:r.id,name:r.name})});
        };
        $('#setup').hidden=true;$('#editBtn').hidden=false;$('#authBtn').hidden=false;currentView='title';setEditMode(false);renderGrid();
      },files);
      const start=async(id,name)=>{
        await page.evaluate(({id,name})=>{
          const before=TitleEditor.getJobs().map(j=>j.id);
          const call={id,name,done:false};window.calls.push(call);
          Promise.resolve(renameVideo(items.find(f=>f.id===id),name)).then(()=>{call.done=true;},e=>{call.done=true;call.error=e.message;});
          call.job=TitleEditor.getJobs().find(j=>!before.includes(j.id))?.id;
        },{id,name});
        return page.evaluate(()=>window.calls.at(-1).job);
      };
      const next=async(id,name)=>{
        await page.waitForFunction(({id,name})=>window.requests.some(r=>!r.done&&r.id===id&&r.name===name),{id,name});
        await page.evaluate(()=>window.check());
        assert.deepEqual(await page.evaluate(()=>window.violations),[]);
        return page.evaluate(({id,name})=>window.requests.findIndex(r=>!r.done&&r.id===id&&r.name===name),{id,name});
      };
      const finish=async(index,ok=true)=>{await page.evaluate(({index,ok})=>window.finish(index,ok),{index,ok});};
      const settle=async(id,name,ok=true)=>finish(await next(id,name),ok);
      const terminal=async()=>page.waitForFunction(()=>TitleEditor.getJobs().length>0&&TitleEditor.getJobs().every(j=>['completed','failed','canceled','restore-failed'].includes(j.state)));
      const drain=async()=>{
        // Wait on observable requests/job states; never auto-resolve arbitrary network traffic.
        for(let n=0;n<80;n++){
          await page.waitForFunction(()=>window.requests.some(r=>!r.done)||(TitleEditor.getJobs().length>0&&TitleEditor.getJobs().every(j=>['completed','failed','canceled','restore-failed'].includes(j.state))));
          const index=await page.evaluate(()=>window.requests.findIndex(r=>!r.done));
          if(index<0){await terminal();return;}
          await finish(index);
        }
        throw Error('Rename failed to settle after 80 PATCHes');
      };
      const names=()=>page.evaluate(()=>Object.fromEntries(items.map(f=>[f.id,f.name])));
      const cancel=async id=>{
        assert.ok(id,'inline rename must register shared progress job');
        await page.locator('#titleProgress .title-job[data-job-id="'+id+'"]').getByRole('button',{name:'제목 작업 '+id+' 취소',exact:true}).click();
      };
      await test({page,start,next,finish,settle,drain,terminal,names,cancel});
      await page.evaluate(()=>window.check());
      assert.deepEqual(await page.evaluate(()=>window.violations),[]);
      assert.deepEqual(errors,[]);console.log('PASS '+label);
    }catch(e){
      failures++;console.error('FAIL '+label+'\n'+e.stack);
      console.error(JSON.stringify(await page.evaluate(()=>({
        requests:window.requests.map(({id,name,done})=>({id,name,done})),
        violations:window.violations,jobs:TitleEditor.getJobs()
      }))));
    }
    finally{await page.close();}
  }
  try{
    await scenario('exact numbered insertion; hidden neighbors; descending PATCH order',[...mario(),['l','Luigi5.mp4']],async h=>{
      await h.page.locator('#catbar .search').fill('Luigi5');
      await h.page.waitForTimeout(200);
      await h.start('l','Mario3.mp4');
      await h.settle('m5','Mario6.mp4');await h.settle('m4','Mario5.mp4');await h.settle('m3','Mario4.mp4');await h.settle('l','Mario3.mp4');await h.terminal();
      assert.deepEqual(await h.names(),{m1:'Mario1.mp4',m2:'Mario2.mp4',m3:'Mario4.mp4',m4:'Mario5.mp4',m5:'Mario6.mp4',l:'Mario3.mp4'});
      assert.deepEqual(await h.page.evaluate(()=>window.requests.map(r=>[r.id,r.name])),[['m5','Mario6.mp4'],['m4','Mario5.mp4'],['m3','Mario4.mp4'],['l','Mario3.mp4']]);
    });
    await scenario('overlapping family queues/replans; independent family runs; controls editable',[...mario(),['l','Luigi5.mp4'],['t','Toad.mp4'],['p','Peach1.mp4'],['d','Daisy.mp4']],async h=>{
      await h.start('l','Mario3.mp4');const first=await h.next('m5','Mario6.mp4');
      await h.start('t','Mario3.mp4');await h.start('d','Peach1.mp4');
      await h.next('p','Peach2.mp4');
      assert.deepEqual(await h.page.evaluate(()=>window.requests.filter(r=>r.id!=='p').map(r=>[r.id,r.name])),[['m5','Mario6.mp4']]);
      const input=h.page.getByRole('textbox',{name:'일괄 이름 변경',exact:true});
      assert.equal(await input.isDisabled(),false);await input.fill('Still editable');assert.equal(await input.inputValue(),'Still editable');
      await h.finish(first);await h.drain();
      assert.deepEqual(await h.names(),{m1:'Mario1.mp4',m2:'Mario2.mp4',m3:'Mario5.mp4',m4:'Mario6.mp4',m5:'Mario7.mp4',l:'Mario4.mp4',t:'Mario3.mp4',p:'Peach2.mp4',d:'Peach1.mp4'});
    });
    await scenario('queued insertion reserves future-shifted neighbor before cross-family rename',[
      ['m1','Mario1.mp4'],['m2','Mario2.mp4'],['m3','Mario3.mp4'],['l','Luigi.mp4'],['t','Toad.mp4']
    ],async h=>{
      const a=await h.start('l','Mario1.mp4');const first=await h.next('m3','Mario4.mp4');
      const b=await h.start('t','Mario3.mp4');const c=await h.start('m2','Peach5.mp4');
      assert.equal(await h.page.evaluate(()=>window.requests.length),1,'B and C wait while A owns neighbors');
      await h.finish(first);await h.settle('m2','Mario3.mp4');await h.settle('m1','Mario2.mp4');await h.settle('l','Mario1.mp4');
      // Keep C unresolved if it races. B must still reach its newly affected m2,
      // exposing concurrent PATCHes rather than hiding the race by settling C first.
      await h.settle('m3','Mario5.mp4');const shifted=await h.next('m2','Mario4.mp4');
      assert.equal(await h.page.evaluate(()=>window.requests.some(r=>r.name==='Peach5.mp4')),false,'C must wait for B reservation on future-shifted m2');
      await h.finish(shifted);await h.settle('t','Mario3.mp4');await h.settle('m2','Peach5.mp4');await h.terminal();
      assert.deepEqual(await h.names(),{m1:'Mario2.mp4',m2:'Peach5.mp4',m3:'Mario5.mp4',l:'Mario1.mp4',t:'Mario3.mp4'});
      assert.deepEqual(await h.page.evaluate(()=>window.drive),await h.names());
      assert.deepEqual(await h.page.evaluate(ids=>ids.map(id=>TitleEditor.getJobs().find(j=>j.id===id).state),[a,b,c]),['completed','completed','completed']);
    });
    await scenario('cancel insertion restores source and every shifted neighbor',[...mario(),['l','Luigi5.mp4']],async h=>{
      const job=await h.start('l','Mario3.mp4');
      await h.settle('m5','Mario6.mp4');await h.settle('m4','Mario5.mp4');await h.settle('m3','Mario4.mp4');
      const incoming=await h.next('l','Mario3.mp4');await h.cancel(job);await h.finish(incoming);await h.drain();
      assert.deepEqual(await h.names(),Object.fromEntries([...mario(),['l','Luigi5.mp4']]));
      assert.equal(await h.page.evaluate(id=>TitleEditor.getJobs().find(j=>j.id===id).state,job),'canceled');
      assert.equal(await h.page.evaluate(()=>window.requests.some(r=>r.id==='l'&&r.name==='Luigi5.mp4')),true);
    });
    await scenario('failed shift aborts dependent insert',[...mario(),['l','Luigi5.mp4']],async h=>{
      const job=await h.start('l','Mario3.mp4');await h.settle('m5','Mario6.mp4');await h.settle('m4','Mario5.mp4',false);await h.drain();
      assert.equal((await h.names()).l,'Luigi5.mp4');
      assert.equal(await h.page.evaluate(()=>window.requests.some(r=>r.id==='l'||(r.id==='m3'&&r.name==='Mario4.mp4'))),false);
      assert.ok(await h.page.evaluate(id=>{const j=TitleEditor.getJobs().find(j=>j.id===id);return j.failed>0||j.state==='failed';},job));
    });
    await scenario('intra-family insertion uses cycle-safe PATCHes',mario(),async h=>{
      await h.start('m5','Mario3.mp4');await h.drain();
      assert.deepEqual(await h.names(),{m1:'Mario1.mp4',m2:'Mario2.mp4',m3:'Mario4.mp4',m4:'Mario5.mp4',m5:'Mario3.mp4'});
    });
    await scenario('failed rollback retries; independent completed rename survives',[...mario(),['l','Luigi5.mp4'],['p','Peach.mp4']],async h=>{
      const job=await h.start('l','Mario3.mp4');
      await h.settle('m5','Mario6.mp4');await h.settle('m4','Mario5.mp4');await h.settle('m3','Mario4.mp4');
      const incoming=await h.next('l','Mario3.mp4');
      await h.start('p','Peach2.mp4');await h.settle('p','Peach2.mp4');
      await h.cancel(job);await h.finish(incoming);
      await h.page.waitForFunction(()=>window.requests.some(r=>!r.done));
      const rollback=await h.page.evaluate(()=>window.requests.findIndex(r=>!r.done));
      await h.finish(rollback,false);await h.drain();
      assert.equal(await h.page.evaluate(id=>TitleEditor.getJobs().find(j=>j.id===id).state,job),'restore-failed');
      await h.page.locator('#titleProgress .title-job[data-job-id="'+job+'"]').getByRole('button',{name:'제목 작업 '+job+' 복원 재시도',exact:true}).click();
      await h.drain();
      assert.equal(await h.page.evaluate(id=>TitleEditor.getJobs().find(j=>j.id===id).state,job),'canceled');
      assert.deepEqual(await h.names(),Object.fromEntries([...mario(),['l','Luigi5.mp4'],['p','Peach2.mp4']]));
    });
    await scenario('different extensions share basename collision family',[['m','Mario3.mp4'],['l','Luigi5.mov']],async h=>{
      await h.start('l','Mario3.mov');await h.settle('m','Mario4.mp4');await h.settle('l','Mario3.mov');await h.terminal();
      assert.deepEqual(await h.names(),{m:'Mario4.mp4',l:'Mario3.mov'});
    });
    await scenario('rollback retry bypasses later same-family waiter without deadlock',[
      ['m','Mario3.mp4'],['l','Luigi.mp4'],['t','Toad.mp4']
    ],async h=>{
      const canceled=await h.start('l','Mario3.mp4');const shift=await h.next('m','Mario4.mp4');
      await h.cancel(canceled);await h.finish(shift);await h.settle('m','Mario3.mp4',false);
      await h.page.waitForFunction(id=>TitleEditor.getJobs().find(j=>j.id===id).state==='restore-failed',canceled);
      const waiter=await h.start('t','Mario3.mp4');
      assert.equal(await h.page.evaluate(()=>window.requests.filter(r=>!r.done).length),0,'failed rollback retains family locks');
      await h.page.locator('#titleProgress .title-job[data-job-id="'+canceled+'"]').getByRole('button',{name:'제목 작업 '+canceled+' 복원 재시도',exact:true}).click();
      await h.settle('m','Mario3.mp4');await h.drain();
      assert.deepEqual(await h.names(),{m:'Mario4.mp4',l:'Luigi.mp4',t:'Mario3.mp4'});
      assert.deepEqual(await h.page.evaluate(ids=>ids.map(id=>TitleEditor.getJobs().find(j=>j.id===id).state),[canceled,waiter]),['canceled','completed']);
    });
    await scenario('rollback waits for earlier insertion into original family',[
      ['x','Mario1.mp4'],['y','Zelda.mp4'],['z','Toad.mp4']
    ],async h=>{
      await h.page.evaluate(()=>{gallery.tags={x:['cross'],y:['cross']};query='cross';renderGrid();});
      const input=h.page.getByRole('textbox',{name:'일괄 이름 변경',exact:true});
      await input.fill('Peach');await input.press('Enter');
      const canceled=await h.page.evaluate(()=>TitleEditor.getJobs().at(-1).id);
      await h.settle('x','Peach1.mp4');const second=await h.next('y','Peach2.mp4');
      const insertion=await h.start('z','Mario1.mp4');const original=await h.next('z','Mario1.mp4');
      await h.cancel(canceled);await h.finish(second);
      await h.page.waitForFunction(id=>['restoring','restore-failed','canceled'].includes(TitleEditor.getJobs().find(j=>j.id===id).state),canceled);
      assert.equal(await h.page.evaluate(()=>window.requests.some(r=>r.id==='x'&&r.name==='Mario1.mp4')),false,'restoration must not race in-flight insert into original basename');
      await h.finish(original);await h.drain();
      // A newer successful edit owns Mario1. Restoration must report the occupied
      // original, preserve that edit, and restore the other free original.
      assert.deepEqual(await h.names(),{x:'Peach1.mp4',y:'Zelda.mp4',z:'Mario1.mp4'});
      assert.deepEqual(await h.page.evaluate(ids=>ids.map(id=>TitleEditor.getJobs().find(j=>j.id===id).state),[canceled,insertion]),['restore-failed','completed']);
    });
    await scenario('pre-existing duplicate numbered basenames shift to unique slots',[
      ['a','Mario3.mp4'],['b','Mario3.mov'],['m4','Mario4.mp4'],['l','Luigi.mov']
    ],async h=>{
      await h.start('l','Mario3.mov');await h.drain();
      const result=await h.names();assert.equal(result.l,'Mario3.mov');
      assert.equal(result.a.endsWith('.mp4'),true);assert.equal(result.b.endsWith('.mov'),true);
      assert.equal(result.m4.endsWith('.mp4'),true);
      const numbers=Object.values(result).map(name=>Number(name.match(/^Mario([0-9]+)\.(?:mp4|mov)$/u)?.[1]));
      assert.equal(numbers.every(Number.isFinite),true);assert.equal(new Set(numbers).size,4);
      assert.equal(numbers.filter(n=>n>=4).length,3);
      assert.deepEqual(await h.page.evaluate(()=>window.drive),result);
    });
    await scenario('unnumbered duplicate numbers existing and incoming',[['m','Mario.mp4'],['l','Luigi.mov']],async h=>{
      await h.start('l','Mario.mov');await h.drain();assert.deepEqual(await h.names(),{m:'Mario1.mp4',l:'Mario2.mov'});
    });
    await scenario('unnumbered incoming appends to numbered family',[...mario(),['l','Luigi.mov']],async h=>{
      await h.start('l','Mario.mov');await h.drain();assert.deepEqual(await h.names(),{...Object.fromEntries(mario()),l:'Mario6.mov'});
    });
    await scenario('numeric order 2/10/20; unrelated prefix untouched',[['m20','Mario20.mp4'],['m2','Mario2.mp4'],['m10','Mario10.mov'],['x','MarioKart2.mp4'],['l','Luigi.mp4']],async h=>{
      await h.start('l','Mario2.mp4');await h.drain();
      assert.deepEqual(await h.names(),{m20:'Mario21.mp4',m2:'Mario3.mp4',m10:'Mario11.mov',x:'MarioKart2.mp4',l:'Mario2.mp4'});
      assert.deepEqual(await h.page.evaluate(()=>window.requests.map(r=>r.id)),['m20','m10','m2','l']);
    });
    await scenario('cancel older insertion preserves newer shifted names',[...mario(),['l','Luigi.mp4'],['t','Toad.mp4'],['u','Other.mp4']],async h=>{
      const a=await h.page.evaluate(()=>TitleEditor.submitRenames([
        {file:items.find(f=>f.id==='l'),name:'Mario3.mp4'},
        {file:items.find(f=>f.id==='u'),name:'Fox.mp4'}]).jobId);
      await h.settle('m5','Mario6.mp4');await h.settle('m4','Mario5.mp4');
      await h.settle('m3','Mario4.mp4');await h.settle('l','Mario3.mp4');
      const held=await h.next('u','Fox.mp4');
      await h.start('t','Mario3.mp4');
      await h.settle('m5','Mario7.mp4');await h.settle('m4','Mario6.mp4');
      await h.settle('m3','Mario5.mp4');await h.settle('l','Mario4.mp4');await h.settle('t','Mario3.mp4');
      await h.cancel(a);await h.finish(held);await h.drain();
      assert.deepEqual(await h.names(),{m1:'Mario1.mp4',m2:'Mario2.mp4',m3:'Mario5.mp4',m4:'Mario6.mp4',m5:'Mario7.mp4',l:'Mario4.mp4',t:'Mario3.mp4',u:'Other.mp4'});
      const job=await h.page.evaluate(id=>TitleEditor.getJobs().find(j=>j.id===id),a);
      assert.equal(job.state,'canceled');assert.equal(job.rollbackSkipped,4);assert.equal(job.rollbackFailed,0);
    });
    await scenario('word removal UI uses shared collision scheduler',[['m','Mario.mp4'],['l','Mario copy.mov']],async h=>{
      await h.page.locator('#catbar .search').fill('copy');await h.page.waitForTimeout(200);
      const input=h.page.getByRole('textbox',{name:'완전한 단어 제거',exact:true});await input.fill('copy');await input.press('Enter');
      await h.drain();assert.deepEqual(await h.names(),{m:'Mario1.mp4',l:'Mario2.mov'});
    });
  }finally{await browser.close();}
  assert.equal(failures,0,failures+' rename collision scenario(s) failed');
})().catch(e=>{console.error(e);process.exitCode=1;});
