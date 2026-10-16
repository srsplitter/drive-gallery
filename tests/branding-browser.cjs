const {chromium}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const version='20261017-logo2';
const brandingVersion='20261017-safari3';
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.hostname!=='gallery.test')return route.abort();
    const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
    const contentType={'.js':'application/javascript','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/html; charset=utf-8';
    return route.fulfill({contentType,body:fs.readFileSync(file)});
  });
  const geometry=()=>page.evaluate(()=>({header:document.querySelector('header').getBoundingClientRect().top,bottom:document.querySelector('header').getBoundingClientRect().bottom,nav:document.querySelector('#catbar').getBoundingClientRect().top}));
  const imageSize=src=>page.evaluate(async src=>{const img=new Image();img.src=src;await img.decode();return [img.naturalWidth,img.naturalHeight];},src);
  const universalIcons=async()=>{
    const apple=page.locator('link[rel="apple-touch-icon"]');
    assert.equal(await apple.getAttribute('href'),'apple-touch-icon.png');
    assert.equal(await apple.getAttribute('sizes'),'180x180');
    assert.deepEqual(await imageSize(await apple.getAttribute('href')),[180,180]);
    const precomposed=page.locator('link[rel="apple-touch-icon-precomposed"]');
    assert.equal(await precomposed.getAttribute('href'),'apple-touch-icon-precomposed.png');
    assert.equal(await precomposed.getAttribute('sizes'),'180x180');
    assert.deepEqual(await imageSize(await precomposed.getAttribute('href')),[180,180]);
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'),`manifest.webmanifest?v=${version}`);
    const manifest=await page.evaluate(async()=>{
      const response=await fetch(document.querySelector('link[rel="manifest"]').href);
      if(!response.ok)throw Error('Manifest unavailable');
      return {type:response.headers.get('content-type'),body:await response.json(),url:response.url};
    });
    assert.ok(manifest.type.startsWith('application/manifest+json'));
    assert.equal(manifest.body.display,'browser');
    for(const size of [192,512]){
      const entry=manifest.body.icons.find(icon=>icon.src===`icons/gallery-${size}.png?v=${version}`);
      assert.ok(entry,`Missing manifest icon ${size}`);
      assert.equal(entry.sizes,`${size}x${size}`);assert.equal(entry.type,'image/png');
      assert.deepEqual(await imageSize(new URL(entry.src,manifest.url).href),[size,size]);
    }
  };
  const defaultIcons=async()=>{
    assert.equal(await page.locator('#brandIcon img').getAttribute('src'),'icons/gallery-192.png');
    assert.deepEqual(await imageSize('icons/gallery-192.png'),[192,192]);
    const favicon=page.locator('link[rel="icon"]');
    assert.equal(await favicon.count(),1);
    assert.equal(await favicon.getAttribute('href'),'site-icon-20261017.png');
    assert.equal(await favicon.getAttribute('type'),'image/png');
    assert.equal(await favicon.getAttribute('sizes'),'180x180');
    assert.deepEqual(await imageSize(await favicon.getAttribute('href')),[180,180]);
  };
  try{
    await page.goto('https://gallery.test/');assert.equal(await page.title(),'갤러리');
    await defaultIcons();await universalIcons();
    assert.equal(await page.locator('script[src^="branding.js"]').getAttribute('src'),`branding.js?v=${brandingVersion}`);
    for(const asset of ['site-icon-20261017.png','apple-touch-icon.png','apple-touch-icon-precomposed.png']){
      assert.deepEqual(fs.readFileSync(path.join(root,asset)),fs.readFileSync(path.join(root,'icons/gallery-180.png')),`${asset} must match source PNG`);
      assert.deepEqual(await imageSize(asset),[180,180]);
    }
    for(const size of [32,180,192,512])assert.deepEqual(await imageSize(`icons/gallery-${size}.png`),[size,size]);
    assert.deepEqual(await imageSize('favicon.svg'),[192,192]);
    const svg=fs.readFileSync(path.join(root,'favicon.svg'),'utf8');
    const embedded=svg.match(/(?:xlink:)?href=["']data:image\/png;base64,([^"']+)["']/);
    assert.ok(embedded,'Legacy SVG must embed replacement PNG');
    assert.deepEqual(Buffer.from(embedded[1],'base64'),fs.readFileSync(path.join(root,'icons/gallery-192.png')));
    assert.doesNotMatch(svg,/<(?:path|ellipse|circle|polygon|rect)\b/i,'Legacy peach vector must be removed');
    const ico=fs.readFileSync(path.join(root,'favicon.ico'));
    assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),3);
    const icoSizes=[];
    for(let i=0;i<3;i++){
      const entry=6+i*16,width=ico[entry]||256,height=ico[entry+1]||256;
      icoSizes.push(width);assert.equal(height,width);
      const length=ico.readUInt32LE(entry+8),offset=ico.readUInt32LE(entry+12),png=ico.subarray(offset,offset+length);
      assert.equal(png.length,length);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.deepEqual(await imageSize('data:image/png;base64,'+png.toString('base64')),[width,height]);
    }
    assert.deepEqual(icoSizes.sort((a,b)=>a-b),[16,32,48]);
    // Chromium does not expose bare /favicon.ico to this routed fixture (even
    // fetch fails before route/requestfailed). Decode the exact root file bytes;
    // defaultIcons separately decodes the public PNG URL. Verify bare
    // root HTTP status, MIME and byte hash against deployment outside this fixture.
    const legacyIco=await imageSize('data:image/x-icon;base64,'+ico.toString('base64'));
    assert.ok([16,32,48].includes(legacyIco[0])&&legacyIco[0]===legacyIco[1]);
    assert.ok((await page.locator('#siteLogo').textContent()).includes('갤러리'));
    const viewport=await page.locator('meta[name="viewport"]').getAttribute('content');
    for(const setting of ['width=device-width','initial-scale=1','viewport-fit=cover'])assert.ok(viewport.split(',').map(v=>v.trim()).includes(setting));
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
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('type'),'image/png');
    assert.equal(await page.locator('link[rel="icon"]').getAttribute('sizes'),null);
    await universalIcons();
    assert.ok(await page.evaluate(()=>window.savedChanges.some(([k])=>k==='u:icon')));
    const dimensions=await page.evaluate(async()=>{const img=new Image();img.src=gallery.settings.icon;await img.decode();return [img.naturalWidth,img.naturalHeight];});
    assert.deepEqual(dimensions,[256,256]);
    await page.evaluate(()=>Branding.apply(null));await defaultIcons();
    await page.evaluate(value=>{const data={settings:{},videos:{}};applyChanges(data,new Map([['u:icon',value]]));window.roundtrip=data.settings.icon;Branding.apply(data.settings.icon);},value);
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
    await defaultIcons();await universalIcons();
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
    await defaultIcons();await universalIcons();
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
    const safariContext=await browser.newContext({
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      viewport:{width:390,height:844},isMobile:true,hasTouch:true,
    });
    try{
      const safari=await safariContext.newPage(),safariErrors=[];
      safari.setDefaultTimeout(5000);safari.on('pageerror',e=>safariErrors.push(e.message));
      await safariContext.route('**/*',async route=>{
        const u=new URL(route.request().url()),prefix='/drive-gallery/';
        if(u.hostname!=='gallery.test'||!u.pathname.startsWith(prefix))return route.abort();
        const relative=u.pathname.slice(prefix.length)||'index.html';
        const file=path.resolve(root,relative);
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
        const contentType={'.js':'application/javascript','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/html; charset=utf-8';
        return route.fulfill({contentType,body:fs.readFileSync(file)});
      });
      const safariMetadata=async()=>{
        const favicon=safari.locator('link[rel="icon"]');
        assert.equal(await favicon.count(),1);
        assert.equal(await favicon.getAttribute('href'),'site-icon-20261017.png');
        assert.equal(await favicon.getAttribute('type'),'image/png');
        assert.equal(await favicon.getAttribute('sizes'),'180x180');
        for(const [rel,asset] of [['icon','site-icon-20261017.png'],['apple-touch-icon','apple-touch-icon.png'],['apple-touch-icon-precomposed','apple-touch-icon-precomposed.png']]){
          assert.equal(await safari.locator(`link[rel="${rel}"]`).getAttribute('sizes'),'180x180');
          const metadata=await safari.evaluate(async rel=>{
            const link=document.querySelector(`link[rel="${rel}"]`),response=await fetch(link.href);
            const img=new Image();img.src=link.href;await img.decode();
            return {url:link.href,status:response.status,type:response.headers.get('content-type'),size:[img.naturalWidth,img.naturalHeight],bytes:Array.from(new Uint8Array(await response.arrayBuffer()))};
          },rel);
          assert.equal(metadata.url,`https://gallery.test/drive-gallery/${asset}`);
          assert.equal(metadata.status,200);assert.equal(metadata.type,'image/png');
          assert.deepEqual(metadata.size,[180,180]);
          assert.deepEqual(Buffer.from(metadata.bytes),fs.readFileSync(path.join(root,'icons/gallery-180.png')));
        }
      };
      await safari.goto('https://gallery.test/drive-gallery/');await safariMetadata();
      await safari.evaluate(value=>{
        token='safari-account';gallery={videos:{},settings:{icon:value}};
        window.savedChanges=[];flushSaves=async()=>{window.savedChanges.push(...pendingSaves);pendingSaves.clear();};
        Branding.apply(gallery.settings.icon);
      },value);
      assert.equal(await safari.locator('#brandIcon img').getAttribute('src'),value);
      await safariMetadata();
      const safariChooser=safari.waitForEvent('filechooser');await safari.locator('#siteLogo').click();
      await (await safariChooser).setFiles({name:'safari-icon.png',mimeType:'image/png',buffer:fs.readFileSync(path.join(root,'icons/gallery-180.png'))});
      await safari.waitForFunction(old=>gallery.settings.icon!==old,value);
      const uploaded=await safari.evaluate(()=>gallery.settings.icon);
      assert.ok(uploaded.startsWith('data:image/png;base64,'));
      assert.equal(await safari.locator('#brandIcon img').getAttribute('src'),uploaded);
      assert.ok(await safari.evaluate(()=>window.savedChanges.some(([k])=>k==='u:icon')));
      await safariMetadata();
      await safari.evaluate(()=>showLoggedOut());
      assert.equal(await safari.locator('#brandIcon img').getAttribute('src'),'icons/gallery-192.png');
      await safariMetadata();assert.deepEqual(safariErrors,[]);
    }finally{await safariContext.close();}
    const edgeContext=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/130.0.2849.68 Version/18.0 Mobile/15E148 Safari/605.1.15'});
    try{
      const edge=await edgeContext.newPage(),edgeErrors=[];
      edge.on('pageerror',e=>edgeErrors.push(e.message));
      await edgeContext.route('**/*',async route=>{
        const u=new URL(route.request().url());if(u.hostname!=='gallery.test')return route.abort();
        const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
        if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
        const contentType={'.js':'application/javascript','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[path.extname(file)]||'text/html; charset=utf-8';
        return route.fulfill({contentType,body:fs.readFileSync(file)});
      });
      await edge.goto('https://gallery.test/');
      await edge.evaluate(value=>Branding.apply(value),value);
      assert.equal(await edge.locator('#brandIcon img').getAttribute('src'),value);
      assert.equal(await edge.locator('link[rel="icon"]').getAttribute('href'),value);
      assert.equal(await edge.locator('link[rel="icon"]').getAttribute('type'),'image/png');
      assert.equal(await edge.locator('link[rel="icon"]').getAttribute('sizes'),null);
      assert.deepEqual(edgeErrors,[]);
    }finally{await edgeContext.close();}
    assert.deepEqual(errors,[]);console.log('PASS public PNG180 favicon/apple/precomposed assets, unchanged logo2 manifest, safari3 branding, legacy ICO/SVG decode, Chrome/Edge iOS custom favicon, iPhone Safari UA subpath account apply/upload/logout static favicon and custom header, viewport/sticky layout, settings persistence/account isolation (Chromium fixture; native Safari icon UI not tested)');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
