// 모자이크 해제 (헤더 [편집] 패널 아래, 수정 ON·PC).
// "모자이크" 태그를 붙인 영상을 하나씩: 드라이브에서 조금씩 읽어 이 PC 의 도우미(tools/lada-helper.cjs → Lada)에 넘김
// → 처리된 영상을 받아 이 브라우저 임시 저장공간에 모음 → 같은 드라이브 파일에 덮어씀(태그·썸네일·순서 그대로, 드라이브에 이전 버전이 남음)
// → 태그를 "모자이크 해제"로 바꾸고 다음 영상. 얼굴 모자이크는 도우미가 건드리지 않게 실행함.
// index.html 전역(api, DRIVE, items, tagsOf, setTags, renderGrid, toast, el, ensureWriteScope, token, tokenExp)과 MergeUI.tools 를 씀.
const DecensorUI = (() => {
  const HELPER = 'http://127.0.0.1:7861';
  const TAG = '모자이크', DONE = '모자이크 해제';
  const CHUNK = 8 * 1024 * 1024;
  let running = false, ctrl = null, helperOk = null, current = null;
  const failed = new Set(); // 이번에 실패한 영상 (다시 시작할 때까지 건너뜀)
  const results = []; // 최근 결과 [{ name, ok, text }]
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const inMerge = f => MergeUI.jobs.some(j => (j.state === 'waiting' || j.state === 'running') && j.list.some(p => p.f.id === f.id));
  const queue = () => items.filter(f => tagsOf(f).includes(TAG) && +f.size > 0 && !failed.has(f.id) && !inMerge(f));

  async function hx(path, opts = {}) {
    const r = await fetch(HELPER + path, opts);
    if (!r.ok) throw new Error(`도우미 응답 오류 (${r.status})`);
    return r;
  }
  async function checkHelper() {
    try { helperOk = !!(await (await hx('/status')).json()).ok; } catch { helperOk = false; }
    update();
    return helperOk;
  }

  // ---- 화면: 한 번 만든 칸을 계속 고쳐 씀 (진행률이 바뀔 때마다 목록 전체를 다시 그리지 않게) ----
  // el 등은 index.html 본문 스크립트가 이 파일보다 늦게 정의하므로 처음 그릴 때 만듦
  let bar, label, status, waiting, go, done, box;
  function build() {
    bar = el('div', { className: 'merge-bar' }, el('i'));
    label = el('div', { className: 'hint' });
    status = el('p', { className: 'hint' });
    waiting = el('p', { className: 'hint' });
    go = el('button', { className: 'primary' });
    done = el('div', { className: 'decensor-results' });
    box = el('div', { className: 'm-sec decensor' },
      el('b', { textContent: '모자이크 해제 (Lada)' }), status, waiting,
      el('div', { className: 'row' }, go, el('button', { className: 'small', textContent: '도우미 다시 확인', onclick: checkHelper })), bar, label, done,
      el('p', { className: 'hint', textContent: `영상에 "${TAG}" 태그를 붙이면 차례로 처리해요. 끝난 영상은 같은 드라이브 파일에 덮어쓰고(드라이브에 원본이 이전 버전으로 30일 남음) 태그가 "${DONE}"(으)로 바뀌어요. 얼굴 모자이크는 건드리지 않아요. 처리하는 동안 이 탭과 PC 의 도우미 창을 켜 두세요.` }));
  }
  function show(pct, text) {
    bar.firstChild.style.width = pct.toFixed(1) + '%';
    label.textContent = text;
  }
  function update() {
    if (!box) return;
    status.textContent = helperOk === null ? '도우미 확인 중…' : helperOk ? '이 PC 의 도우미와 연결됨'
      : '도우미가 꺼져 있어요. PC 에서 tools\\lada-helper.bat 을 켠 뒤 [도우미 다시 확인]을 눌러 주세요.';
    status.className = 'hint' + (helperOk === false ? ' error' : '');
    const q = queue();
    waiting.textContent = `"${TAG}" 태그가 붙은 영상 ${q.length}개 대기` + (failed.size ? ` · 이번에 실패한 ${failed.size}개는 건너뜀` : '');
    go.textContent = running ? '멈추기' : '시작';
    go.disabled = !running && (!helperOk || !q.length);
    go.onclick = running ? stop : start;
    bar.hidden = label.hidden = !current;
    done.replaceChildren(...results.slice(-5).map(r => el('p', { className: 'hint' + (r.ok ? '' : ' error'), textContent: (r.ok ? '완료 · ' : '실패 · ') + r.name + (r.text ? ' — ' + r.text : '') })));
  }
  function section() {
    if (!box) build();
    if (helperOk === null) checkHelper();
    update();
    return box;
  }

  // ---- 영상 하나 처리 ----
  async function processOne(f, signal) {
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
        show(20 * at / size, `도우미에 넘기는 중 ${(at / 1e6).toFixed(0)} / ${(size / 1e6).toFixed(0)}MB`);
      }
      // 2) Lada 처리 (20~80%)
      let job;
      for (;;) {
        job = await (await hx(`/jobs/${id}`, { signal })).json();
        if (job.state === 'failed') throw new Error(job.error || 'Lada 처리 실패');
        if (job.state === 'done') break;
        show(20 + 0.6 * job.progress, `모자이크 해제 중 ${job.progress}%`);
        await sleep(2000);
        if (signal.aborted) throw new DOMException('멈췄어요', 'AbortError');
      }
      // 3) 결과를 임시 저장공간에 모은 뒤 같은 파일에 덮어씀 (80~100%)
      const made = await withTemp('lada-' + f.id + '.mp4', async tmp => {
        const w = tmp.writable.getWriter();
        for (let at = 0; at < job.outSize;) {
          const end = Math.min(at + CHUNK, job.outSize);
          const r = await hx(`/jobs/${id}/output`, { headers: { Range: `bytes=${at}-${end - 1}` }, signal });
          const data = new Uint8Array(await r.arrayBuffer());
          if (data.length !== end - at) throw new Error('도우미에서 받은 길이가 맞지 않아요');
          await w.write({ position: at, data });
          at = end;
          show(80 + 10 * at / job.outSize, `결과 받는 중 ${(at / 1e6).toFixed(0)} / ${(job.outSize / 1e6).toFixed(0)}MB`);
        }
        await w.close();
        const blob = await tmp.file();
        if (!(token && Date.now() < tokenExp)) await waitLogin(signal);
        const m = await driveUpload({}, blob, n => show(90 + 10 * n / blob.size, `드라이브에 덮어쓰는 중 ${(n / 1e6).toFixed(0)} / ${(blob.size / 1e6).toFixed(0)}MB`), signal, f.id, upload);
        if (!m || +m.size !== blob.size) throw new Error('드라이브에 다 올라갔는지 확인하지 못했어요. 원본은 그대로예요.');
        return m;
      });
      upload.url = null;
      Object.assign(f, { size: made.size, mimeType: made.mimeType || f.mimeType });
      setTags(f, tagsOf(f).map(t => (t === TAG ? DONE : t)));
    } catch (e) {
      if (upload.url) fetch(upload.url, { method: 'DELETE' }).catch(() => {}); // 올리다 만 건 버림 → 원본 그대로
      throw e;
    } finally {
      fetch(`${HELPER}/jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // ---- 대기열: 태그가 붙은 영상이 없을 때까지 하나씩 ----
  async function start() {
    if (running || !await checkHelper()) return;
    if (!await ensureWriteScope()) return;
    failed.clear();
    running = true;
    ctrl = new AbortController();
    update();
    let n = 0;
    try {
      for (let f; running && (f = queue()[0]);) {
        current = f;
        update();
        show(0, `"${f.name}" 시작`);
        try {
          await processOne(f, ctrl.signal);
          n++;
          results.push({ name: f.name, ok: true });
        } catch (e) {
          if (e.name === 'AbortError') { results.push({ name: f.name, ok: false, text: '멈춤 (원본 그대로)' }); break; }
          failed.add(f.id);
          results.push({ name: f.name, ok: false, text: e.message + ' (원본 그대로)' });
          if (!await checkHelper()) break; // 도우미가 꺼졌으면 대기열도 멈춤
        }
      }
    } finally {
      running = false;
      current = null;
      ctrl = null;
      renderGrid();
      toast(n ? `모자이크 해제: 영상 ${n}개 완료` : '모자이크 해제를 멈췄어요.');
    }
  }
  function stop() {
    running = false;
    if (ctrl) ctrl.abort();
    update();
  }
  addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  return { section, get running() { return running; } };
})();
