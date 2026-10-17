// 헤더 [편집] → 영상 합치기 (수정 ON, PC 크롬·엣지).
// 필터·검색으로 영상을 찾고 썸네일을 누르면 누른 순서대로 담김 → 합친 영상 맨 앞 1초에 넣을 장면을 하나 고름
// (담은 영상들의 지정 썸네일 중에서, 또는 영상 아래 가위로 그 영상의 한 지점을 찍어서)
// → 이름을 정하고 [합치기] → 드라이브에서 조금씩 읽어 합치고 조금씩 드라이브에 올림 → 다 올라간 걸 확인한 뒤에만 원본을 휴지통으로.
// index.html 의 전역(api, DRIVE, UPLOAD, token, tokenExp, AuthError, ensureWriteScope, items, renderGrid, openViewer, viewer,
// el, $, setStatus, trashVideo …)을 씀.
const MergeUI = (() => {
  let active = false;
  // 합치기 작업 대기열: 담아서 [합치기]를 누를 때마다 하나씩 쌓이고 차례로 처리(압축기는 하나라 동시에 돌려도 빨라지지 않음)
  // job = { id, name, list:[{f}], intro, state:'waiting'|'running'|'done'|'failed'|'canceled', ctrl, url, el, show() }
  const jobs = [];
  let jobSeq = 0, fixing = null;
  const unfinished = () => jobs.filter(j => j.state === 'waiting' || j.state === 'running');
  // 대기 중이거나 진행 중인 작업에 들어간 영상 (다른 작업에 또 담지 못하게)
  const reserved = () => new Set(unfinished().flatMap(j => j.list.map(p => p.f.id)));
  let picks = []; // [{ f }] 담은 순서
  let intro = null; // 합친 영상 맨 앞 1초 장면 { img: 캔버스·이미지, url: 미리보기, key: 고른 썸네일의 영상 ID | null(가위로 찍음) }
  let nameDraft = '', nameError = ''; // nameError: 이름 칸 아래 빨간 안내
  const isPC = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && 'VideoEncoder' in window;

  function toggleMode() {
    active = !active;
    if (!active) { picks = []; intro = null; }
    renderGrid();
  }
  function toggle(f) {
    const at = picks.findIndex(p => p.f.id === f.id);
    if (at < 0 && reserved().has(f.id)) return setStatus(`"${f.name}" 은(는) 이미 다른 합치기 작업에 들어 있어요.`, true);
    if (at >= 0) picks.splice(at, 1); else picks.push({ f });
    renderGrid();
  }
  // 카드에 담긴 순서 번호
  function decorate(card, f) {
    if (!active) return;
    if (reserved().has(f.id)) { card.classList.add('merge-reserved'); return; }
    const at = picks.findIndex(p => p.f.id === f.id);
    if (at < 0) return;
    card.classList.add('merge-picked');
    card.querySelector('.thumb').append(el('span', { className: 'series-order-badge', textContent: String(at + 1) }));
  }

  // 가위: 그 영상의 창을 열어 지점을 고르고 "이 지점으로 썸네일 설정" → 그 장면을 합친 영상 맨 앞 1초로
  function pickIntro(p) {
    window.mergePick = { f: p.f, done: canvas => {
      let url = '';
      try { url = canvas.toDataURL('image/jpeg', 0.7); } catch {}
      intro = { img: canvas, url, key: null };
      window.mergePick = null;
      renderGrid();
    } };
    openViewer(p.f);
  }

  const NS = 'http://www.w3.org/2000/svg';
  function upArrow() { // 위쪽 화살표 (선)
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'up-ico');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M12 19V5M5 12l7-7 7 7');
    svg.append(p);
    return svg;
  }
  function scissors() { // 가위 아이콘 (선)
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'scissors-ico');
    for (const [tag, attrs] of [['circle', { cx: 6, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }],
      ['path', { d: 'M8.6 7.6 20 18M8.6 16.4 20 6M14 12h0' }]]) {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      svg.append(n);
    }
    return svg;
  }
  // 담은 영상들이 갖고 있던 지정 썸네일 (같은 화면 출처라 캔버스에 그려도 됨 — 드라이브 기본 썸네일은 다른 출처라 못 씀)
  function ownedThumbs() {
    return picks.map(p => ({ key: p.f.id, name: p.f.name, c: gallery.videos[p.f.id] })).filter(o => o.c && (o.c.thumb || o.c.file))
      .map(o => ({ key: o.key, name: o.name, url: o.c.thumb ? Promise.resolve(o.c.thumb) : thumbUrl(o.c.file) }));
  }
  function thumbOf(f) {
    const custom = gallery.videos[f.id];
    const img = el('img', { alt: '', referrerPolicy: 'no-referrer' });
    if (custom && custom.thumb) img.src = custom.thumb;
    else if (custom && custom.file) thumbUrl(custom.file).then(u => { img.src = u; }, () => {});
    else if (f.thumbnailLink) img.src = f.thumbnailLink.replace(/=s\d+$/, '=s320');
    return img;
  }

  function panel() {
    const box = $('#mergePanel');
    box.hidden = !active && !jobs.length;
    let top = $('#mergeTop');
    if (!top) {
      top = el('button', { id: 'mergeTop', title: '맨 위로', onclick: () => scrollTo({ top: 0, behavior: 'smooth' }) }, upArrow());
      top.setAttribute('aria-label', '맨 위로');
      document.body.append(top);
    }
    top.hidden = !active;
    if (!active) { if (jobs.length) box.replaceChildren(jobsView()); return; }
    const nameIn = el('input', { className: 'm-in', placeholder: '합친 영상 이름 (예: 겨울왕국 모음)', value: nameDraft,
      oninput: () => { nameDraft = nameIn.value; if (nameError) { nameError = ''; nameErr.remove(); } } });
    const nameErr = el('p', { className: 'hint error', textContent: nameError });
    // 0번 칸: 합친 영상 맨 앞 1초 장면 (고른 경우에만)
    const zero = intro ? el('div', { className: 'merge-item merge-zero' },
      el('div', { className: 'merge-thumb' }, el('img', { src: intro.url, alt: '' }), el('span', { className: 'series-order-badge', textContent: '0' })),
      el('div', { className: 'merge-name', textContent: '맨 앞 1초 장면' }),
      el('div', { className: 'row merge-item-btns' }, el('button', { className: 'small', textContent: '빼기', onclick: () => { intro = null; renderGrid(); } }))) : null;
    const list = el('div', { className: 'merge-list' }, ...(zero ? [zero] : []), ...picks.map((p, i) => {
      const move = d => () => { const j = i + d; if (j < 0 || j >= picks.length) return; [picks[i], picks[j]] = [picks[j], picks[i]]; renderGrid(); };
      const cut = el('button', { className: 'merge-cut', title: '이 영상의 한 지점을 찍어 맨 앞 1초 장면으로', onclick: () => pickIntro(p) },
        scissors(), el('span', { textContent: '이 영상에서 장면 찍기' }));
      return el('div', { className: 'merge-item' },
        el('div', { className: 'merge-thumb' }, thumbOf(p.f), el('span', { className: 'series-order-badge', textContent: String(i + 1) })),
        el('div', { className: 'merge-name', textContent: p.f.name, title: p.f.name }),
        cut,
        el('div', { className: 'row merge-item-btns' },
          el('button', { className: 'small', textContent: '◀', title: '앞으로', disabled: i === 0, onclick: move(-1) }),
          el('button', { className: 'small', textContent: '▶', title: '뒤로', disabled: i === picks.length - 1, onclick: move(1) }),
          el('button', { className: 'small', textContent: '빼기', onclick: () => toggle(p.f) })));
    }));
    const owned = ownedThumbs();
    const choices = el('div', { className: 'merge-choices' }, ...owned.map(o => {
      const img = el('img', { alt: '', title: o.name + ' 의 썸네일' });
      o.url.then(u => { img.src = u; }, () => img.parentElement && img.parentElement.remove());
      return el('button', { className: 'merge-choice' + (intro && intro.key === o.key ? ' on' : ''), title: o.name + ' 의 썸네일을 맨 앞 1초 장면으로',
        onclick: async () => {
          const u = await o.url;
          const im = new Image();
          await new Promise((ok, bad) => { im.onload = ok; im.onerror = () => bad(new Error('썸네일을 불러오지 못했어요')); im.src = u; });
          intro = { img: im, url: u, key: o.key };
          renderGrid();
        } }, img);
    }));
    const introSec = picks.length ? el('div', { className: 'm-sec merge-intro' },
      el('b', { textContent: '맨 앞 1초 장면 고르기' + (intro ? ' (위 0번 칸)' : ' (지금은 없음 — 바로 첫 영상부터 시작)') }),
      owned.length ? choices : null,
      el('p', { className: 'hint', textContent: owned.length ? '담은 영상들의 썸네일을 누르면 그 장면이 맨 앞 1초가 돼요. 다른 장면은 영상 아래 가위로 찍으세요.' : '담은 영상 아래 가위로 영상의 한 지점을 찍으면 맨 앞 1초 장면이 돼요.' })) : null;
    const go = el('button', { className: 'primary m-big', textContent: unfinished().length ? `${picks.length}개 합치기 (작업 목록에 추가)` : `${picks.length}개 합치기`,
      disabled: picks.length < 2, onclick: start });
    box.replaceChildren(...[
      el('div', { className: 'row' }, el('b', { textContent: '영상 합치기' }),
        el('span', { className: 'hint', textContent: '검색·필터로 영상을 찾고 썸네일을 누른 순서대로 담겨요. 다시 누르면 빠져요.' })),
      picks.length ? list : el('p', { className: 'hint', textContent: '아직 담은 영상이 없어요.' }),
      introSec,
      el('div', { className: 'm-sec' }, el('b', { textContent: '합친 영상 이름' }), nameIn, ...(nameError ? [nameErr] : [])),
      el('p', { className: 'hint', textContent: '합친 영상은 첫 영상이 있는 드라이브 폴더에 올라가고, 다 올라간 걸 확인한 뒤 원본은 드라이브 휴지통으로 옮겨져요(30일 안에 복원 가능). 해상도는 첫 영상에 맞추고, 합치는 동안 이 탭을 열어 두세요.' }),
      isPC() ? null : el('p', { className: 'hint error', textContent: '영상 합치기는 PC 크롬·엣지에서만 돼요.' }),
      el('div', { className: 'row' }, go, el('button', { textContent: '닫기', onclick: toggleMode })),
      jobs.length ? jobsView() : null].filter(Boolean));
  }

  // ---- 드라이브에서 조금씩 읽기 (로그인이 만료되면 다시 로그인할 때까지 기다렸다 이어서) ----
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitLogin(signal) {
    setStatus('로그인 시간이 끝나 합치기를 잠시 멈췄어요. 위쪽 🔑 다시 로그인을 누르면 이어서 해요.', true);
    while (!(token && Date.now() < tokenExp)) {
      if (signal.aborted) throw new DOMException('취소했어요', 'AbortError');
      await sleep(1000);
    }
    setStatus('');
  }
  const driveRead = (f, signal) => async (start, end) => {
    for (let tries = 0; ; tries++) {
      try {
        const r = await api(`${DRIVE}/files/${f.id}?alt=media`, { headers: { Range: `bytes=${start}-${end - 1}` }, signal });
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length !== end - start) throw new Error(`"${f.name}" 을(를) 읽다가 길이가 맞지 않아요`);
        return buf;
      } catch (e) {
        if (signal.aborted) throw e;
        if (e instanceof AuthError) { await waitLogin(signal); continue; }
        if (tries < 3) { await sleep(1500 * (tries + 1)); continue; }
        throw e;
      }
    }
  };

  // ---- 합친 파일은 먼저 이 브라우저의 임시 저장공간(OPFS)에 표준 MP4 로 다 만듦 ----
  // (MP4 는 끝난 뒤 파일 앞쪽의 길이 칸을 다시 써야 해서, 드라이브에 바로 이어 올릴 수 없음)
  async function tempFile(name) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const ws = await handle.createWritable();
    const writable = new WritableStream({
      write: chunk => ws.write({ type: 'write', position: chunk.position, data: chunk.data }),
      close: () => ws.close(),
      abort: () => ws.abort(),
    });
    return { writable, file: () => handle.getFile(), remove: () => root.removeEntry(name).catch(() => {}) };
  }

  const lockName = name => 'drive-gallery-tmp:' + name;
  function withTemp(name, fn) {
    const run = async () => { const tmp = await tempFile(name); try { return await fn(tmp); } finally { await tmp.remove(); } };
    return navigator.locks ? navigator.locks.request(lockName(name), run) : run();
  }
  // 아무 탭도 쓰고 있지 않은 임시 파일(갑자기 닫힌 탭이 남긴 것)을 지움
  async function sweepTemps() {
    try {
      const root = await navigator.storage.getDirectory();
      const held = new Set(navigator.locks ? (await navigator.locks.query()).held.map(l => l.name) : []);
      for await (const name of root.keys()) {
        // 크롬이 쓰는 중에 옆에 두는 .crswap 은 본 파일 이름의 잠금으로 판단 (다른 탭이 쓰는 중이면 건드리지 않음)
        const base = name.replace(/\.crswap$/, '');
        if (/^(merge|fix)-/.test(base) && !held.has(lockName(base))) await root.removeEntry(name).catch(() => {});
      }
    } catch {}
  }
  let swept = false;

  // ---- 다 만든 파일을 드라이브에 8MB 씩 올리기 (재개 가능 업로드). 조각은 256KB 배수, 드라이브가 위치를 확인함 ----
  const UNIT = 256 * 1024, CHUNK = 32 * UNIT; // 8MB
  // fileId 가 있으면 새 파일 대신 그 파일의 내용을 바꿈(파일 ID·이름·태그는 그대로, 드라이브에 이전 버전이 남음)
  async function driveUpload(meta, blob, onSent, signal, fileId, job) {
    const fields = 'fields=id,name,size,mimeType,parents,thumbnailLink,videoMediaMetadata(durationMillis)';
    const r = await api(fileId ? `${UPLOAD}/files/${fileId}?uploadType=resumable&${fields}` : `${UPLOAD}/files?uploadType=resumable&${fields}`, {
      method: fileId ? 'PATCH' : 'POST', signal,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(meta) });
    const url = r.headers.get('Location');
    if (!url) throw new Error('드라이브 업로드 주소를 받지 못했어요.');
    if (job) job.url = url;
    let result = null;
    for (let sent = 0; sent < blob.size;) {
      const end = Math.min(sent + CHUNK, blob.size);
      const bytes = blob.slice(sent, end);
      for (let tries = 0; ; tries++) {
        let res;
        try { res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${blob.size}` }, body: bytes, signal }); }
        catch (e) { if (signal.aborted || tries >= 4) throw e; await sleep(2000 * (tries + 1)); continue; }
        if (res.status === 308 || res.ok) { if (res.ok) result = await res.json(); break; }
        if (res.status >= 500 && tries < 4) { await sleep(2000 * (tries + 1)); continue; }
        throw new Error(`드라이브 업로드 실패 (${res.status})`);
      }
      sent = end;
      onSent(sent);
    }
    return result;
  }

  // ---- 합치기: [합치기] = 작업 목록에 추가하고 담기 칸은 비움 → 하나씩 차례로 ----
  async function start() {
    if (picks.length < 2) return;
    if (!isPC()) return setStatus('영상 합치기는 PC 크롬·엣지에서만 돼요.', true);
    let name = (nameDraft || '').trim();
    if (!name) { nameError = '합친 영상 이름을 적어야 합칠 수 있어요.'; renderGrid(); $('#mergePanel .m-in')?.focus(); return; }
    nameError = '';
    if (!/\.mp4$/i.test(name)) name += '.mp4';
    if (picks.some(p => !(+p.f.size > 0))) return setStatus('크기 정보가 없는 영상이 있어 합칠 수 없어요.', true);
    const taken = reserved();
    if (picks.some(p => taken.has(p.f.id))) return setStatus('이미 다른 합치기 작업에 들어간 영상이 있어요.', true);
    if (!await ensureWriteScope()) return;
    if (!swept) { swept = true; await sweepTemps(); }
    const job = { id: ++jobSeq + '-' + Date.now().toString(36), name, list: picks.map(p => ({ ...p })), intro, state: 'waiting', ctrl: new AbortController(), url: null };
    jobView(job);
    jobs.push(job);
    picks = [];
    intro = null;
    nameDraft = '';
    renderGrid();
    setStatus(`"${name}" 을(를) 합치기 작업 목록에 넣었어요.`);
    pump();
  }

  // 차례가 된 작업 하나 실행 (고치기 중이면 끝날 때까지 기다림)
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (let job; (job = jobs.find(j => j.state === 'waiting'));) {
        while (fixing) await sleep(1000);
        if (job.state === 'waiting') await runJob(job);
      }
    } finally { pumping = false; }
  }

  // 작업이 남아 있으면 탭을 닫기 전에 한 번 확인
  addEventListener('beforeunload', e => { if (unfinished().length || fixing) { e.preventDefault(); e.returnValue = ''; } });

  function jobView(job) {
    const bar = el('div', { className: 'merge-bar' }, el('i'));
    const label = el('div', { className: 'hint' });
    const btn = el('button', { className: 'small' });
    job.el = el('div', { className: 'merge-job' }, el('div', { className: 'row' }, el('b', { textContent: job.name }), btn), bar, label);
    job.show = (pct, text) => {
      const state = job.state;
      if (pct !== undefined) bar.firstChild.style.width = pct.toFixed(1) + '%';
      label.textContent = text !== undefined ? text : state === 'waiting' ? `차례를 기다리는 중 · 영상 ${job.list.length}개` : label.textContent;
      job.el.dataset.state = state;
      btn.textContent = state === 'waiting' || state === 'running' ? '취소' : '지우기';
      btn.onclick = () => {
        if (state === 'waiting') { job.state = 'canceled'; job.show(0, '취소했어요.'); renderGrid(); }
        else if (state === 'running') job.ctrl.abort();
        else { jobs.splice(jobs.indexOf(job), 1); renderGrid(); }
      };
    };
    job.show(0);
  }
  function jobsView() {
    return el('div', { className: 'm-sec merge-jobs' }, el('b', { textContent: '합치기 작업' }), ...jobs.map(j => j.el));
  }

  // ---- 합친 뒤 번호 다시 매기기 ----
  // "마리오 1~8" 중 1~3 을 합치면 남은 4~8 → 1~5. 합친 영상 이름이 같은 앞부분에 번호(예: 마리오1)면 그 번호는 비워 두고 나머지를 채움 → 2~6
  function titleParts(name) {
    const m = String(name).match(/^(.*?)(.[^.]+)?$/);
    const base = m[1], ext = m[2] || '';
    const n = base.match(/^(.*?)([0-9]+)$/);
    return { stem: n ? n[1] : base, key: (n ? n[1] : base).normalize('NFKC').toLowerCase().trim(), number: n ? Number(n[2]) : null, ext };
  }
  function renumberPlans(originals, made) {
    const keys = new Set(originals.map(f => titleParts(f.name)).filter(p => p.number !== null).map(p => p.key));
    const m = titleParts(made.name), plans = [];
    for (const key of keys) {
      const family = items.map(f => ({ f, p: titleParts(f.name) }))
        .filter(x => x.f.id !== made.id && x.p.number !== null && x.p.key === key)
        .sort((a, b) => a.p.number - b.p.number);
      const taken = m.number !== null && m.key === key ? m.number : null;
      let n = 1;
      for (const { f, p } of family) {
        if (n === taken) n++;
        const name = p.stem + n + p.ext;
        if (name !== f.name) plans.push({ f, name });
        n++;
      }
    }
    return plans;
  }
  async function renumber(plans) {
    let ok = 0;
    for (const { f, name } of plans) {
      try {
        await api(`${DRIVE}/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        f.name = name;
        ok++;
      } catch {}
    }
    return ok;
  }

  async function runJob(job) {
    const { list, name, ctrl } = job;
    job.state = 'running';
    // 진행률: 합치기 0~70%, 올리기 70~100%
    let prog = { done: 0, total: 1, part: 0 }, up = 0, upTotal = 0;
    const show = () => {
      const pct = upTotal ? 70 + 30 * up / upTotal : Math.min(70, 70 * prog.done / prog.total);
      job.show(pct, upTotal ? `${pct.toFixed(0)}% · 드라이브에 올리는 중 ${(up / 1e6).toFixed(0)} / ${(upTotal / 1e6).toFixed(0)}MB`
        : `${pct.toFixed(0)}% · ${prog.part + 1}/${list.length}번째 영상 합치는 중`);
    };
    show();
    try {
      const first = list[0].f;
      // 임시 저장공간이 넉넉한지 (합친 영상은 대략 원본 합보다 조금 클 수 있음)
      const need = list.reduce((s, p) => s + +p.f.size, 0) * 1.3;
      const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
      if (est && est.quota - est.usage < need) throw new Error(`PC 의 브라우저 임시 공간이 부족해요 (필요 약 ${(need / 1e9).toFixed(1)}GB)`);
      const made = await withTemp('merge-' + job.id + '.mp4', async tmp => {
        await VideoMerge.merge({
          parts: list.map((p, i) => ({ name: p.f.name, size: +p.f.size, read: driveRead(p.f, ctrl.signal), intro: i === 0 && job.intro ? job.intro.img : null })),
          writable: tmp.writable, signal: ctrl.signal, onProgress: p => { prog = p; show(); },
        });
        const blob = await tmp.file();
        upTotal = blob.size;
        show();
        const m = await driveUpload({ name, mimeType: 'video/mp4', parents: (first.parents || []).slice(0, 1) }, blob, n => { up = n; show(); }, ctrl.signal, null, job);
        if (!m || !m.id || +m.size !== blob.size) throw new Error('드라이브에 다 올라갔는지 확인하지 못했어요. 원본은 그대로 두었어요.');
        return m;
      });
      job.url = null;
      // 다 올라간 걸 확인함 → 원본을 휴지통으로 (실패한 건 그대로 둠)
      job.show(100, '다 올렸어요. 원본을 휴지통으로 옮기는 중…');
      let trashed = 0;
      for (const p of list) {
        try {
          await api(`${DRIVE}/files/${p.f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
          const at = items.findIndex(x => x.id === p.f.id);
          if (at >= 0) items.splice(at, 1);
          trashed++;
        } catch {}
      }
      items.unshift({ ...made, category: first.category });
      // 원본이 번호 붙은 제목이면 남은 같은 제목들의 번호를 빈칸 없이 다시 매김 (휴지통으로 옮긴 원본만 빠진 것으로 봄)
      const gone = list.filter(p => !items.some(x => x.id === p.f.id)).map(p => p.f);
      const plans = renumberPlans(gone, made);
      let renamed = 0;
      if (plans.length) { job.show(100, `번호를 다시 매기는 중… (${plans.length}개)`); renamed = await renumber(plans); }
      // 원본들이 갖고 있던 태그를 합쳐 붙임 (같은 태그는 한 번만, 원본 순서대로)
      const tags = [...new Set(list.flatMap(p => tagsOf(p.f)))];
      if (tags.length) { gallery.tags[made.id] = tags; pendingSaves.set('t:' + made.id, tags); }
      // 하트: 하나라도 있으면 하트. 표시: 별이 하나라도 있으면 별, 아니면 네모가 있으면 네모
      if (list.some(p => isLoved(p.f))) { gallery.loved[made.id] = true; pendingSaves.set('l:' + made.id, true); }
      const marks = list.map(p => gallery.marks[p.f.id]);
      const mark = marks.includes('star') ? 'star' : marks.includes('square') ? 'square' : null;
      if (mark) { gallery.marks[made.id] = mark; pendingSaves.set('m:' + made.id, mark); }
      flushSaves();
      job.state = 'done';
      job.show(100, `만들었어요. 원본 ${trashed}/${list.length}개를 드라이브 휴지통으로 옮겼어요(30일 안에 복원 가능).`
        + (trashed < list.length ? ' 옮기지 못한 원본은 그대로 있어요.' : '')
        + (plans.length ? ` 남은 영상 ${renamed}/${plans.length}개의 번호를 다시 매겼어요.` : ''));
    } catch (e) {
      if (job.url) fetch(job.url, { method: 'DELETE' }).catch(() => {}); // 올리다 만 파일은 버림
      job.url = null;
      job.state = e.name === 'AbortError' ? 'canceled' : 'failed';
      job.show(undefined, e.name === 'AbortError' ? '취소했어요. 원본은 그대로예요.' : '합치지 못했어요: ' + e.message + ' (원본은 그대로예요)');
    }
    renderGrid();
  }

  // ---- 조각 MP4 고치기: 영상 창(수정 ON, PC)에서 조각 형식이면 버튼을 보여 주고, 다시 압축하지 않고 표준 MP4 로 바꿔 같은 파일에 덮어씀 ----
  async function offerFix(f) {
    const slot = $('#fixSlot');
    if (!slot || !isPC() || !document.body.classList.contains('editing') || !(+f.size > 0) || !/mp4|quicktime|m4v/.test(f.mimeType || '')) return;
    const ctrl = new AbortController();
    let frag = false;
    try { frag = await VideoMerge.isFragmented(driveRead(f, ctrl.signal), +f.size); } catch { return; }
    if (!frag || viewerFile !== f || !slot.isConnected) return;
    const label = el('span', { className: 'hint', textContent: '이 영상은 조각 MP4 형식이라 폰에서 앞 몇 초만 재생될 수 있어요.' });
    const btn = el('button', { className: 'primary', textContent: '폰 재생용으로 고치기' });
    btn.onclick = () => fix(f, slot, btn, label);
    slot.replaceChildren(el('div', { className: 'row' }, btn, label));
  }
  async function fix(f, slot, btn, label) {
    if (fixing) return;
    if (jobs.some(j => j.state === 'running')) { label.textContent = '합치기 작업이 끝난 뒤에 다시 눌러 주세요.'; return; }
    if (!await confirmBox(`"${f.name}" 을(를) 다시 압축하지 않고 표준 MP4 로 바꿔 같은 파일에 덮어써요. 화질은 그대로이고, 드라이브에 이전 버전이 남아요. 진행할까요?`, '고치기', false)) return;
    if (!await ensureWriteScope()) return;
    const ctrl = new AbortController();
    fixing = { ctrl, url: null };
    btn.disabled = true;
    const cancel = el('button', { textContent: '취소', onclick: () => ctrl.abort() });
    btn.after(cancel);
    try {
      const made = await withTemp('fix-' + f.id + '.mp4', async tmp => {
        await VideoMerge.remux({ size: +f.size, read: driveRead(f, ctrl.signal), writable: tmp.writable, signal: ctrl.signal,
          onProgress: p => { label.textContent = `옮겨 담는 중 ${Math.round(p * 70)}%`; } });
        const blob = await tmp.file();
        const m = await driveUpload({}, blob, n => { label.textContent = `드라이브에 올리는 중 ${Math.round(70 + 30 * n / blob.size)}%`; }, ctrl.signal, f.id, fixing);
        if (!m || +m.size !== blob.size) throw new Error('드라이브에 다 올라갔는지 확인하지 못했어요.');
        return m;
      });
      fixing.url = null;
      f.size = made.size;
      slot.replaceChildren(el('span', { className: 'hint', textContent: '고쳤어요. 이제 폰에서도 끝까지 재생돼요. (드라이브가 새로 처리하는 동안 잠깐 재생이 안 될 수 있어요)' }));
    } catch (e) {
      if (fixing.url) fetch(fixing.url, { method: 'DELETE' }).catch(() => {});
      label.textContent = e.name === 'AbortError' ? '취소했어요. 원본은 그대로예요.' : '고치지 못했어요: ' + e.message + ' (원본은 그대로예요)';
      btn.disabled = false;
      cancel.remove();
    } finally {
      fixing = null;
    }
  }

  return { get active() { return active; }, get busy() { return unfinished().length > 0 || !!fixing; }, jobs, toggleMode, toggle, decorate, panel, isPC, offerFix };
})();
