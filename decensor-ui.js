// 헤더 [모자이크] 탭: "모자이크" 태그가 붙은 영상을 모아 보여 주고, 이 PC 의 Lada 로 모자이크를 해제하는 작업 공간 (합치기와 별개).
// 수정 ON 에서 카드를 누르면 작업 대기열에 넣고(다시 누르면 뺌), 작업은 하나씩 차례로 → 하나가 도는 동안에도 다른 영상을 계속 대기열에 올릴 수 있음.
// 작업 하나: 드라이브에서 조금씩 읽어 도우미(tools/lada-helper.cjs → Lada)에 넘김 → 처리된 영상을 이 브라우저 임시 저장공간에 모음
// → 같은 드라이브 파일에 덮어씀(태그·썸네일·순서 그대로, 드라이브에 이전 버전이 남음) → "모자이크" 태그를 뗌. 얼굴 모자이크는 도우미가 건드리지 않게 실행함.
// 대기열에 든 영상은 합치기에 담을 수 없고, 합치기 작업에 든 영상은 대기열에 넣을 수 없음 (서로 간섭하지 않게).
// index.html 전역(api, items, tagsOf, setTags, renderGrid, toast, el, videoCard, ensureWriteScope, token, tokenExp)과 MergeUI.tools 를 씀.
const DecensorUI = (() => {
  const HELPER = 'http://127.0.0.1:7861';
  const TAG = '모자이크';
  const CHUNK = 8 * 1024 * 1024;
  const jobs = []; // { id, f, state: 'waiting'|'running'|'done'|'failed'|'canceled', ctrl, el, show() }
  let helperOk = null, seq = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const editing = () => document.body.classList.contains('editing');
  const unfinished = () => jobs.filter(j => j.state === 'waiting' || j.state === 'running');
  const jobOf = f => unfinished().find(j => j.f.id === f.id);
  const reservedIds = () => new Set(unfinished().map(j => j.f.id));
  const inMerge = f => MergeUI.jobs.some(j => (j.state === 'waiting' || j.state === 'running') && j.list.some(p => p.f.id === f.id));

  async function hx(path, opts = {}) {
    const r = await fetch(HELPER + path, opts);
    if (!r.ok) throw new Error(`도우미 응답 오류 (${r.status})`);
    return r;
  }
  async function checkHelper() {
    const was = helperOk;
    try { helperOk = !!(await (await hx('/status')).json()).ok; } catch { helperOk = false; }
    if (helperOk !== was && currentView === 'mosaic') renderGrid();
    if (helperOk) pump();
    return helperOk;
  }

  // ---- 대기열 ----
  function add(f) {
    if (jobOf(f)) return;
    if (inMerge(f)) return setStatus(`"${f.name}" 은(는) 합치기 작업에 들어 있어서 넣을 수 없어요.`, true);
    if (!(+f.size > 0)) return setStatus(`"${f.name}" 은(는) 크기 정보가 없어 처리할 수 없어요.`, true);
    const job = { id: ++seq, f, state: 'waiting', ctrl: new AbortController() };
    jobView(job);
    jobs.push(job);
  }
  async function toggle(f) {
    if (!editing()) return;
    const job = jobOf(f);
    // 진행 중인 작업은 카드를 잘못 눌러 멈추지 않게 위 목록의 [취소]로만
    if (job && job.state === 'running') return setStatus(`"${f.name}" 은(는) 처리 중이에요. 멈추려면 위 작업 목록의 [취소]를 누르세요.`);
    if (job) { cancel(job); return renderGrid(); }
    if (!await ensureWriteScope()) return;
    add(f);
    renderGrid();
    pump();
  }
  async function addAll(list) {
    if (!await ensureWriteScope()) return;
    for (const f of list) if (!jobOf(f) && !inMerge(f)) add(f);
    renderGrid();
    pump();
  }
  function cancel(job) {
    if (job.state === 'waiting') { job.state = 'canceled'; job.show(0, '대기열에서 뺐어요.'); }
    else if (job.state === 'running') job.ctrl.abort();
  }

  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (let job; (job = jobs.find(j => j.state === 'waiting'));) {
        if (!await checkHelperQuiet()) break; // 도우미가 꺼져 있으면 기다림 (켜고 [도우미 다시 확인]을 누르면 이어서)
        job.state = 'running';
        job.ctrl = new AbortController();
        job.show(0, '시작');
        if (currentView === 'mosaic') renderGrid();
        try {
          await processOne(job);
          job.state = 'done';
          job.show(100, '끝났어요. "모자이크" 태그를 뗐어요.');
        } catch (e) {
          job.state = e.name === 'AbortError' ? 'canceled' : 'failed';
          job.show(undefined, (e.name === 'AbortError' ? '취소했어요.' : '실패: ' + e.message) + ' 원본은 그대로예요.');
        }
        renderGrid();
      }
    } finally { pumping = false; }
  }
  async function checkHelperQuiet() {
    try { helperOk = !!(await (await hx('/status')).json()).ok; } catch { helperOk = false; }
    if (!helperOk && currentView === 'mosaic') renderGrid();
    return helperOk;
  }

  // ---- 작업 하나 ----
  async function processOne(job) {
    const { f, ctrl: { signal } } = job;
    const { driveRead, withTemp, driveUpload, waitLogin } = MergeUI.tools;
    const size = +f.size;
    const { id } = await (await hx('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size }), signal })).json();
    const upload = { url: null };
    try {
      // 1) 드라이브 → 도우미 (0~20%)
      const read = driveRead(f, signal);
      for (let at = 0; at < size;) {
        const end = Math.min(at + CHUNK, size);
        await hx(`/jobs/${id}/input?offset=${at}`, { method: 'PUT', body: await read(at, end), signal });
        at = end;
        job.show(20 * at / size, `도우미에 넘기는 중 ${(at / 1e6).toFixed(0)} / ${(size / 1e6).toFixed(0)}MB`);
      }
      // 2) Lada 처리 (20~80%)
      let st;
      for (;;) {
        st = await (await hx(`/jobs/${id}`, { signal })).json();
        if (st.state === 'failed') throw new Error(st.error || 'Lada 처리 실패');
        if (st.state === 'done') break;
        job.show(20 + 0.6 * st.progress, `모자이크 해제 중 ${st.progress}%`);
        await sleep(2000);
        if (signal.aborted) throw new DOMException('취소했어요', 'AbortError');
      }
      // 3) 결과를 임시 저장공간에 모은 뒤 같은 파일에 덮어씀 (80~100%)
      const made = await withTemp('lada-' + f.id + '.mp4', async tmp => {
        const w = tmp.writable.getWriter();
        for (let at = 0; at < st.outSize;) {
          const end = Math.min(at + CHUNK, st.outSize);
          const r = await hx(`/jobs/${id}/output`, { headers: { Range: `bytes=${at}-${end - 1}` }, signal });
          const data = new Uint8Array(await r.arrayBuffer());
          if (data.length !== end - at) throw new Error('도우미에서 받은 길이가 맞지 않아요');
          await w.write({ position: at, data });
          at = end;
          job.show(80 + 10 * at / st.outSize, `결과 받는 중 ${(at / 1e6).toFixed(0)} / ${(st.outSize / 1e6).toFixed(0)}MB`);
        }
        await w.close();
        const blob = await tmp.file();
        if (!(token && Date.now() < tokenExp)) await waitLogin(signal);
        const m = await driveUpload({}, blob, n => job.show(90 + 10 * n / blob.size, `드라이브에 덮어쓰는 중 ${(n / 1e6).toFixed(0)} / ${(blob.size / 1e6).toFixed(0)}MB`), signal, f.id, upload);
        if (!m || +m.size !== blob.size) throw new Error('드라이브에 다 올라갔는지 확인하지 못했어요.');
        return m;
      });
      upload.url = null;
      Object.assign(f, { size: made.size, mimeType: made.mimeType || f.mimeType });
      setTags(f, tagsOf(f).filter(t => t !== TAG));
    } catch (e) {
      if (upload.url) fetch(upload.url, { method: 'DELETE' }).catch(() => {}); // 올리다 만 건 버림 → 원본 그대로
      throw e;
    } finally {
      fetch(`${HELPER}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  addEventListener('beforeunload', e => { if (unfinished().length) { e.preventDefault(); e.returnValue = ''; } });

  // ---- 화면 ----
  function jobView(job) {
    const bar = el('div', { className: 'merge-bar' }, el('i'));
    const label = el('div', { className: 'hint' });
    const btn = el('button', { className: 'small' });
    job.el = el('div', { className: 'merge-job' }, el('div', { className: 'row' }, el('b', { textContent: job.f.name }), btn), bar, label);
    job.show = (pct, text) => {
      const state = job.state;
      if (pct !== undefined) bar.firstChild.style.width = pct.toFixed(1) + '%';
      label.textContent = text !== undefined ? text : state === 'waiting' ? '차례를 기다리는 중' : label.textContent;
      job.el.dataset.state = state;
      btn.textContent = state === 'waiting' || state === 'running' ? '취소' : state === 'failed' ? '다시' : '지우기';
      btn.onclick = () => {
        if (state === 'waiting' || state === 'running') cancel(job);
        else if (state === 'failed' && !jobOf(job.f)) { job.state = 'waiting'; job.show(0); pump(); }
        else jobs.splice(jobs.indexOf(job), 1);
        renderGrid();
      };
    };
    job.show(0);
  }
  // [모자이크] 탭에 보일 영상: "모자이크" 태그가 붙었거나 대기열에 든 것 (정렬은 다른 화면과 같은 자동 정렬)
  const filter = list => list.filter(f => tagsOf(f).includes(TAG) || jobOf(f));
  function view(list, counts) {
    if (helperOk === null) checkHelper();
    const free = list.filter(f => !jobOf(f) && !inMerge(f));
    const status = el('p', { className: 'hint' + (helperOk === false ? ' error' : ''), textContent: helperOk === null ? '도우미 확인 중…'
      : helperOk ? '이 PC 의 도우미와 연결됨' : '도우미가 꺼져 있어요. PC 에서 tools\\lada-helper.bat 을 켠 뒤 [도우미 다시 확인]을 눌러 주세요. 대기열은 그대로 기다려요.' });
    const panel = el('div', { className: 'm-sec decensor' },
      el('b', { textContent: '모자이크 해제 (Lada)' }), status,
      el('div', { className: 'row' },
        el('button', { className: 'primary edit-only', textContent: `대기열에 모두 넣기 (${free.length})`, disabled: !free.length, onclick: () => addAll(free) }),
        el('button', { className: 'small', textContent: '도우미 다시 확인', onclick: checkHelper })),
      el('p', { className: 'hint', textContent: editing()
        ? '카드를 누르면 대기열에 넣고, 다시 누르면 빼요. 작업은 하나씩 차례로 돌고, 도는 동안에도 계속 넣을 수 있어요. 끝난 영상은 같은 드라이브 파일에 덮어쓰고(드라이브에 원본이 이전 버전으로 30일 남음) "모자이크" 태그를 떼요. 얼굴 모자이크는 건드리지 않아요. 처리하는 동안 이 탭과 PC 의 도우미 창을 켜 두세요.'
        : '수정 ON 에서 카드를 눌러 모자이크 해제 대기열에 넣을 수 있어요.' }),
      jobs.length ? el('div', { className: 'merge-jobs' }, ...jobs.map(j => j.el)) : null);
    const grid = el('div', { className: 'cat-grid' }, ...list.map(f => videoCard(f, counts)));
    return el('div', { id: 'mosaicView' }, panel,
      el('h2', { className: 'section-title', textContent: `모자이크 (${list.length})` }),
      list.length ? grid : el('p', { className: 'hint', textContent: `"${TAG}" 태그가 붙은 영상이 없어요.` }));
  }
  // 카드 표시: 대기열 순번 / 진행 중, 합치기 작업에 든 영상은 흐리게
  function decorate(card, f) {
    const job = jobOf(f);
    if (job) {
      card.classList.add('mosaic-queued');
      const n = unfinished().filter(j => j.state === 'waiting').indexOf(job) + 1;
      card.querySelector('.thumb').append(el('span', { className: 'series-order-badge', textContent: job.state === 'running' ? '진행 중' : '대기 ' + n }));
    } else if (currentView === 'mosaic' && inMerge(f)) card.classList.add('merge-reserved');
  }

  return { view, filter, toggle, decorate, reservedIds };
})();
