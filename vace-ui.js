// Local VACE test: gallery video selection, static edit box, preview/download only.
// Drive OAuth stays in the gallery; the helper receives video bytes, never tokens.
window.VaceUI = (() => {
  'use strict';
  const BASE = 'http://127.0.0.1:7862';
  const CHUNK = 8 * 1024 * 1024;
  const ACTIVE_KEY = 'vace-test-job';
  let current = null;
  const make = (tag, props = {}, ...children) => {
    const element = Object.assign(document.createElement(tag), props);
    for (const child of children.flat()) if (child) element.append(child);
    return element;
  };
  const button = (text, click, props = {}) => make('button', { type: 'button', textContent: text, onclick: click, ...props });
  const label = (text, input) => make('label', {}, make('span', { textContent: text }), input);
  const help = text => make('p', { className: 'hint', textContent: text });
  const clamp = n => Math.max(0, Math.min(1, n));
  const validSize = size => Number.isSafeInteger(size) && size > 0;
  const formatSize = size => size >= 1e9 ? `${(size / 1e9).toFixed(2)}GB` : `${(size / 1e6).toFixed(1)}MB`;
  const hasSession = () => typeof token !== 'undefined' && token && Date.now() < tokenExp && !document.getElementById('authBtn')?.dataset.expired;
  function galleryChoices(query = '') {
    // Logout retains items in the host app; never show those without a loaded session.
    if (!hasSession() || !document.getElementById('login')?.hidden || !document.getElementById('grid')?.children.length) return [];
    const includeHidden = typeof showHidden !== 'undefined' && showHidden && document.body.classList.contains('editing');
    const needle = query.trim().toLocaleLowerCase();
    return items.filter(f => (!isHidden(f) || includeHidden) &&
      (String(f.name || '').toLocaleLowerCase().includes(needle) || tagsOf(f).some(tag => tag.toLocaleLowerCase().includes(needle))));
  }

  const style = make('style', { textContent: `
    .vace-dialog { width:min(900px,calc(100vw - 24px)); max-height:90dvh; padding:0; }
    .vace-dialog .v-head { position:sticky; top:0; z-index:1; background:var(--panel); }
    .vace-content { display:grid; gap:16px; padding:16px; }
    .vace-content section { min-width:0; }
    .vace-content h3 { margin:0 0 10px; font-size:16px; }
    .vace-content p { margin:6px 0; overflow-wrap:anywhere; }
    .vace-content label { display:grid; gap:5px; min-width:0; font-size:13px; color:var(--dim); }
    .vace-content input,.vace-content select,.vace-content textarea { box-sizing:border-box; width:100%; padding:9px; border:1px solid var(--line); border-radius:8px; color:var(--text); background:var(--bg); font:inherit; }
    .vace-content textarea { min-height:84px; resize:vertical; }
    .vace-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:10px 0; }
    .vace-box-fields { grid-template-columns:repeat(4,minmax(0,1fr)); }
    .vace-content canvas { display:block; width:100%; height:auto; background:#111; border-radius:8px; touch-action:none; cursor:crosshair; }
    .vace-content video { display:block; width:100%; max-height:55dvh; background:#111; border-radius:8px; }
    .vace-status { padding:12px; background:var(--bg); border:1px solid var(--line); border-radius:10px; }
    .vace-status[data-error="true"] { border-color:#b64d4d; }
    .vace-content [hidden] { display:none !important; }
    .vace-content a.btn { display:inline-block; padding:8px 12px; }
    .vace-content progress { width:100%; accent-color:var(--accent); }
    .vace-content button:focus-visible,.vace-content a:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
    .vace-video-list { display:grid; gap:6px; margin:10px 0; max-height:320px; overflow-y:auto; }
    .vace-video-list button { display:grid; grid-template-columns:112px minmax(0,1fr); gap:12px; align-items:center; width:100%; text-align:left; white-space:normal; overflow-wrap:anywhere; padding:10px 12px; }
    .vace-video-list small { color:var(--dim); font-size:12px; }
    .vace-video-thumb { display:grid; place-items:center; width:112px; aspect-ratio:16/9; overflow:hidden; border-radius:6px; background:var(--bg); color:var(--dim); }
    .vace-video-thumb img { display:block; width:100%; height:100%; object-fit:cover; }
    .vace-video-info { display:grid; gap:5px; min-width:0; }
    .vace-video-tags { display:flex; flex-wrap:wrap; gap:4px; }
    .vace-video-tag { padding:2px 6px; border:1px solid var(--line); border-radius:6px; font-size:11px; color:var(--dim); }
    .vace-video-tag.match { color:var(--text); border-color:var(--accent); }
    @media(max-width:520px) { .vace-box-fields { grid-template-columns:repeat(2,minmax(0,1fr)); } .vace-content { padding:12px; } }
  ` });
  document.head.append(style);

  function remembered() {
    try { return JSON.parse(sessionStorage.getItem(ACTIVE_KEY) || 'null'); } catch { return null; }
  }
  function remember(value) {
    try { if (value) sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(value)); else sessionStorage.removeItem(ACTIVE_KEY); } catch {}
  }

  function open(file = null) {
    if (current) { current.dialog.focus(); return; }
    const abort = new AbortController(), urls = new Set();
    const state = { upload: null, file: null, image: null, box: null, busy: false, polling: null, job: null, frameRequest: 0, page: 0, choiceVersion: 0, availableBytes: null };
    const thumbnails = new Set();
    const returnFocus = document.activeElement;
    const status = make('p', { role: 'status', ariaLive: 'polite', textContent: 'PC 도우미를 확인하는 중…' });
    const statusPanel = make('div', { className: 'vace-status' }, status);
    const connection = make('div');
    const progress = make('progress', { hidden: true, max: 100, value: 0 });
    const sourceName = help('');
    const uploadButton = button('이 영상으로 테스트 준비', upload, { disabled: true });
    const search = make('input', { type: 'search', placeholder: '제목 또는 태그 검색', ariaLabel: '갤러리 영상 제목 또는 태그 검색' });
    const choices = make('div', { className: 'vace-video-list' });
    const choiceNote = help('');
    const previous = button('이전', () => { state.page--; renderChoices(); });
    const next = button('다음', () => { state.page++; renderChoices(); });
    const pageLabel = make('span', { className: 'hint', ariaLive: 'polite' });
    const refreshChoices = button('목록 다시 확인', () => { state.page = 0; renderChoices(); });
    const picker = make('div', {}, search, choiceNote, choices,
      make('div', { className: 'row' }, previous, pageLabel, next, refreshChoices));
    const changeSource = button('바꾸기', () => {
      if (state.busy) return;
      picker.hidden = false; state.page = 0; renderChoices(); updateRun(); search.focus();
    });
    const selection = make('div', { hidden: true }, make('div', { className: 'row' }, sourceName, changeSource));
    const loginButton = button('Drive 다시 로그인', loginAgain, { hidden: true });
    const sourceSection = make('section', {}, make('h3', { textContent: '1. 갤러리 영상 선택' }),
      picker, selection, loginButton,
      help('테스트 전에 전체 영상을 이 PC로 가져옵니다. 파일 크기만큼의 디스크 공간과 처리용 추가 여유 공간이 필요하며, 도우미가 남은 용량을 확인합니다. 결과는 별도로 내려받습니다.'), uploadButton, progress);
    search.oninput = () => { state.page = 0; renderChoices(); };
    const start = make('input', { type: 'number', min: 0, step: 0.1, value: '0' });
    const duration = make('input', { type: 'number', min: 1, max: 5, step: 0.5, value: '3' });
    const canvas = make('canvas', { width: 832, height: 480 });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '영상 미리보기. 드래그하거나 아래 좌표를 입력해 얼굴 영역을 지정하세요.');
    const canvasBox = make('div', { hidden: true }, canvas);
    const previewButtons = [
      button('시작 장면', () => preview(0)),
      button('중간 장면', () => preview(0.5)),
      button('끝 장면', () => preview(1)),
    ];
    const coords = ['왼쪽 %', '위쪽 %', '오른쪽 %', '아래쪽 %'].map(text => {
      const input = make('input', { type: 'number', min: 0, max: 100, step: 0.1, value: '' });
      input.oninput = () => {
        const values = coords.map(c => c.input.value === '' ? NaN : Number(c.input.value) / 100);
        state.box = values.every(Number.isFinite) ? values : null;
        draw(); updateRun();
      };
      return { input, label: label(text, input) };
    });
    const boxFields = make('div', { className: 'vace-fields vace-box-fields', hidden: true }, coords.map(c => c.label));
    const settings = make('section', { hidden: true }, make('h3', { textContent: '2. 구간과 얼굴 영역' }),
      make('div', { className: 'vace-fields' }, label('시작 시간 (초)', start), label('테스트 길이 (1~5초)', duration)),
      make('div', { className: 'row' }, previewButtons), canvasBox, boxFields,
      help('얼굴의 모자이크를 모두 포함하도록 드래그하세요. 시작·중간·끝 장면에서 같은 박스 안에 얼굴이 들어오는지 확인하세요.'),
      help('이 테스트는 고정된 영역을 사용합니다. 얼굴이 크게 움직이거나 다른 물체에 가려지면 구간을 짧게 줄이세요.'));
    const kind = make('select', { ariaLabel: '가상 얼굴 유형' },
      make('option', { value: 'person', textContent: '성인 인물' }),
      make('option', { value: 'man', textContent: '성인 남성' }),
      make('option', { value: 'woman', textContent: '성인 여성' }));
    const prompt = make('textarea', { maxLength: 1500, ariaLabel: '가상 얼굴 설명' });
    const defaultPrompt = () => `Replace the pixelated face inside the selected region with a natural photorealistic fictional adult ${kind.value}. Match the head angle, skin tone, lighting and video texture. Keep the same face throughout the shot. Preserve the hair, clothing, body motion and background.`;
    prompt.value = defaultPrompt();
    kind.onchange = () => { prompt.value = defaultPrompt(); };
    const runButton = button('가상 얼굴 테스트 시작', generate, { className: 'primary', disabled: true });
    const generation = make('section', { hidden: true }, make('h3', { textContent: '3. 가상 얼굴' }),
      label('얼굴 유형', kind), label('얼굴 설명 (직접 수정 가능)', prompt),
      help('얼굴 품질과 처리 속도를 확인하는 실험 기능입니다. 생성 중에는 PC를 켜 두세요.'), runButton);
    const result = make('section', { hidden: true });
    const content = make('div', { className: 'vace-content' }, statusPanel, connection, sourceSection, settings, generation, result);
    const dialog = make('dialog', { className: 'vace-dialog' },
      make('div', { className: 'v-head' }, make('div', { id: 'vaceTitle', className: 'title', textContent: '가상 얼굴 테스트' }), button('닫기', () => dialog.close())), content);
    dialog.setAttribute('aria-labelledby', 'vaceTitle');
    document.body.append(dialog);
    current = { dialog };
    dialog.addEventListener('close', () => {
      abort.abort(); clearTimeout(state.polling);
      clearThumbnails();
      for (const video of dialog.querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); }
      for (const url of urls) URL.revokeObjectURL(url);
      state.image?.close?.(); dialog.remove(); current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    }, { once: true });
    dialog.showModal();

    function message(text, error = false) {
      if (abort.signal.aborted) return;
      status.textContent = text; statusPanel.dataset.error = String(error);
    }
    async function request(path, options = {}) {
      const response = await fetch(BASE + path, { ...options, signal: options.signal || abort.signal,
        headers: { 'X-Vace-Client': 'drive-gallery', ...options.headers } });
      if (!response.ok) {
        let text = `PC 도우미 응답 오류 (${response.status})`;
        try { const body = await response.json(); text = body.error || body.detail || text; } catch {}
        throw new Error(typeof text === 'string' ? text : JSON.stringify(text));
      }
      return response;
    }
    const jsonPost = (path, data) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
    function fail(error) { if (error.name !== 'AbortError') message(error.message || String(error), true); }
    async function health() {
      if (abort.signal.aborted) return false;
      const healthAbort = new AbortController();
      const cancel = () => healthAbort.abort();
      abort.signal.addEventListener('abort', cancel, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; healthAbort.abort(); }, 12000);
      message('PC 도우미를 확인하는 중…');
      try {
        const value = await (await request('/health', { signal: healthAbort.signal })).json();
        state.availableBytes = Number.isSafeInteger(value.available_upload_bytes) ? value.available_upload_bytes : null;
        connection.replaceChildren();
        if (value.ready) message('이 PC의 VACE 도우미와 연결됐어요.' + (state.availableBytes === null ? ' 짧은 영상으로 결과를 확인하세요.' : ` 현재 가져올 수 있는 영상 크기: ${formatSize(state.availableBytes)}.`));
        else message(value.error || 'PC 도우미는 연결됐지만 모델을 준비 중이에요. 잠시 뒤 다시 확인하세요.', true);
        connection.append(button('도우미 다시 확인', health));
        return value.ready;
      } catch (error) {
        if (abort.signal.aborted) return false;
        message(timedOut ? '12초 안에 PC 도우미의 응답을 받지 못했어요.' : 'PC 도우미에 연결하지 못했어요.', true);
        connection.replaceChildren(help('이 PC에서 C:\\AI\\VACE-local-test\\Start-VACE.cmd를 실행한 뒤 다시 확인하세요.'),
          help('연결이 계속 안 되면 일반 Chrome 또는 Edge에서 이 사이트를 여세요. 로컬 네트워크 연결 허용을 물으면 이 도우미 연결을 허용하세요.'), button('도우미 다시 확인', health));
        return false;
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', cancel);
      }
    }
    function validBox() {
      const b = state.box;
      return b && b.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && b[2] > b[0] && b[3] > b[1];
    }
    function updateRun() {
      runButton.disabled = state.busy || !state.upload || !validBox();
      uploadButton.disabled = state.busy || !state.file || !picker.hidden || !hasSession();
    }
    function busy(value) {
      state.busy = value;
      for (const input of [search, changeSource, refreshChoices, previous, next, ...choices.querySelectorAll('button')]) input.disabled = value;
      for (const input of [start, duration, kind, prompt, ...coords.map(c => c.input), ...previewButtons]) input.disabled = value;
      if (!value && !picker.hidden) renderChoices();
      updateRun();
    }
    function clearThumbnails() {
      state.choiceVersion++;
      for (const img of thumbnails) { img.onerror = null; img.removeAttribute('src'); }
      thumbnails.clear();
    }
    function thumbnail(f) {
      const version = state.choiceVersion;
      const box = make('span', { className: 'vace-video-thumb', textContent: '🎞️' });
      const img = make('img', { alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
      thumbnails.add(img);
      const custom = gallery.videos[f.id];
      const fallback = f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s480') : '';
      const active = () => box.isConnected && !abort.signal.aborted && version === state.choiceVersion && hasSession() && !picker.hidden &&
        (!isHidden(f) || (showHidden && document.body.classList.contains('editing')));
      let usingFallback = false;
      const show = src => {
        if (!active() || !src) return;
        box.replaceChildren(img); img.src = src;
      };
      const useFallback = () => {
        if (!active()) return;
        if (fallback && !usingFallback) { usingFallback = true; show(fallback); }
        else box.replaceChildren(make('span', { textContent: '🎞️' }));
      };
      img.onerror = useFallback;
      queueMicrotask(() => {
        if (!active()) return;
        if (custom?.thumb) show(custom.thumb);
        else if (custom?.file) {
          // thumbUrl owns its shared cache/blob URLs; only discard this row's late result.
          thumbUrl(custom.file).then(src => src ? show(src) : useFallback(), useFallback);
        } else useFallback();
      });
      return box;
    }
    function renderChoices() {
      if (state.busy) return;
      const list = galleryChoices(search.value);
      const pages = Math.max(1, Math.ceil(list.length / 30));
      state.page = Math.max(0, Math.min(state.page, pages - 1));
      clearThumbnails(); choices.replaceChildren();
      if (!hasSession()) {
        choiceNote.textContent = '갤러리에 로그인하면 사이트의 영상 목록에서 바로 선택할 수 있어요. 이 창을 닫고 구글로 로그인하세요.';
      } else if (!list.length) {
        choiceNote.textContent = search.value.trim() ? '제목이나 태그가 일치하는 영상이 없어요.' : '선택할 영상이 없어요. 갤러리 목록이 로딩 중이면 잠시 뒤 목록을 다시 확인하세요.';
      } else {
        choiceNote.textContent = `${list.length.toLocaleString()}개 영상 · 제목을 눌러 선택하세요.`;
        for (const f of list.slice(state.page * 30, (state.page + 1) * 30)) {
          const size = Number(f.size), seconds = Number(f.videoMediaMetadata?.durationMillis) / 1000;
          const details = [Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(seconds / 60)}분 ${Math.floor(seconds % 60)}초` : '',
            validSize(size) ? formatSize(size) : '크기 정보 없음'].filter(Boolean).join(' · ');
          const needle = search.value.trim().toLocaleLowerCase();
          const tags = make('span', { className: 'vace-video-tags' }, tagsOf(f).map(tag => make('span', {
            className: 'vace-video-tag' + (needle && tag.toLocaleLowerCase().includes(needle) ? ' match' : ''), textContent: tag,
          })));
          const option = button('', () => choose(f), { disabled: !validSize(size) });
          option.append(thumbnail(f), make('span', { className: 'vace-video-info' }, make('span', { textContent: f.name }), make('small', { textContent: details }), tags));
          choices.append(option);
        }
      }
      previous.disabled = state.page === 0; next.disabled = state.page + 1 >= pages;
      pageLabel.textContent = list.length ? `${state.page + 1} / ${pages}` : '';
      updateRun();
    }
    function choose(f) {
      if (state.busy) return;
      if (!galleryChoices().some(item => item.id === f.id)) { renderChoices(); return message('로그인 상태와 갤러리 목록을 다시 확인하세요.', true); }
      const size = Number(f.size);
      if (!validSize(size)) return message('파일 크기 정보를 확인할 수 있는 영상을 선택하세요.', true);
      state.file = f; state.upload = null; state.box = null; state.frameRequest++;
      state.image?.close?.(); state.image = null;
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      for (const video of result.querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); }
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear(); result.replaceChildren();
      settings.hidden = generation.hidden = result.hidden = canvasBox.hidden = boxFields.hidden = true;
      coords.forEach(c => { c.input.value = ''; }); start.value = '0'; duration.value = '3';
      sourceName.textContent = `선택한 영상: ${f.name}`;
      selection.hidden = false; picker.hidden = true; loginButton.hidden = true;
      clearThumbnails();
      message('영상을 선택했어요. 이 영상으로 테스트 준비를 눌러 구간과 얼굴 영역을 지정하세요.');
      updateRun(); uploadButton.focus();
    }
    async function loginAgain() {
      loginButton.disabled = true;
      try {
        await relogin();
        if (abort.signal.aborted) return;
        if (hasSession()) { loginButton.hidden = true; message('Drive에 다시 로그인했어요. 영상 준비를 이어갑니다.'); }
        else message('로그인을 완료하지 못했어요. 다시 로그인해 주세요.', true);
      } catch (error) { fail(error); }
      finally { loginButton.disabled = false; updateRun(); }
    }
    function times() {
      const s = Number(start.value), d = Number(duration.value);
      if (!Number.isFinite(s) || s < 0 || !Number.isFinite(d) || d < 1 || d > 5) throw new Error('시작 시간과 1~5초 길이를 확인하세요.');
      if (state.upload?.duration && s + d > state.upload.duration + 0.001) throw new Error('선택한 구간이 영상 길이를 넘어요. 시작 시간이나 길이를 줄이세요.');
      return { start: s, duration: d };
    }
    async function upload() {
      const source = state.file;
      if (!source || state.busy) return message('갤러리에서 테스트할 영상을 선택하세요.', true);
      if (!hasSession()) { loginButton.hidden = false; return message('Drive 로그인이 만료됐어요. 이 창에서 다시 로그인하세요.', true); }
      const size = Number(source.size);
      if (!validSize(size)) return message('영상의 파일 크기 정보가 올바르지 않아요. 목록을 다시 확인하세요.', true);
      busy(true);
      if (!await health()) { busy(false); return; }
      if (state.availableBytes !== null && size > state.availableBytes) {
        busy(false);
        return message(`PC의 여유 공간이 부족해요. 영상 크기 ${formatSize(size)}, 현재 가져올 수 있는 크기 ${formatSize(state.availableBytes)}입니다.`, true);
      }
      progress.hidden = false; progress.value = 0;
      settings.hidden = generation.hidden = result.hidden = true;
      state.upload = null; state.box = null; state.frameRequest++;
      try {
        const upload = await jsonPost('/uploads', { name: source.name, size });
        const read = MergeUI.tools.driveRead(source, abort.signal, on => {
          loginButton.hidden = !on;
          if (on) message('Drive 로그인이 만료되어 기다리는 중이에요. 아래의 Drive 다시 로그인을 눌러 이어가세요.');
        });
        for (let offset = 0; offset < size;) {
          const end = Math.min(offset + CHUNK, size);
          await request(`/uploads/${encodeURIComponent(upload.id)}?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: await read(offset, end) });
          offset = end; progress.value = 100 * offset / size;
          message(`전체 영상을 PC로 가져오는 중 · ${formatSize(offset)} / ${formatSize(size)}`);
        }
        state.upload = await (await request(`/uploads/${encodeURIComponent(upload.id)}`)).json();
        sourceName.textContent = `${source.name} · ${Number(state.upload.duration).toFixed(1)}초`;
        if (state.upload.duration < 1) throw new Error('1초 이상의 영상이 필요해요.');
        start.value = '0'; duration.value = String(Math.min(3, Math.floor(state.upload.duration * 10) / 10));
        settings.hidden = generation.hidden = false;
        await preview(0);
      } catch (error) { fail(error); }
      finally { busy(false); progress.hidden = true; }
    }
    async function preview(fraction) {
      if (!state.upload) return;
      const own = ++state.frameRequest;
      try {
        const range = times();
        const time = range.start + Math.max(0, range.duration - 1 / 16) * fraction;
        const blob = await (await request(`/uploads/${encodeURIComponent(state.upload.id)}/frame?time=${time.toFixed(4)}`)).blob();
        const image = await createImageBitmap(blob);
        if (own !== state.frameRequest || abort.signal.aborted) { image.close(); return; }
        state.image?.close?.(); state.image = image;
        canvas.width = image.width; canvas.height = image.height;
        canvasBox.hidden = boxFields.hidden = false; draw();
        message(`${time.toFixed(2)}초 장면. 모자이크 전체를 덮을 얼굴 영역을 지정하세요.`);
      } catch (error) { fail(error); }
    }
    function draw() {
      if (!state.image) return;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(state.image, 0, 0);
      if (!validBox()) return;
      const [x1, y1, x2, y2] = state.box;
      ctx.fillStyle = '#67d9d42e'; ctx.strokeStyle = '#76eee7'; ctx.lineWidth = Math.max(2, canvas.width / 250);
      ctx.fillRect(x1 * canvas.width, y1 * canvas.height, (x2 - x1) * canvas.width, (y2 - y1) * canvas.height);
      ctx.strokeRect(x1 * canvas.width, y1 * canvas.height, (x2 - x1) * canvas.width, (y2 - y1) * canvas.height);
    }
    let drag = null;
    function point(event) { const r = canvas.getBoundingClientRect(); return [clamp((event.clientX - r.left) / r.width), clamp((event.clientY - r.top) / r.height)]; }
    canvas.onpointerdown = event => {
      if (state.busy || !state.image) return;
      drag = point(event); canvas.setPointerCapture(event.pointerId); event.preventDefault();
    };
    canvas.onpointermove = event => {
      if (!drag) return;
      const p = point(event); state.box = [Math.min(drag[0], p[0]), Math.min(drag[1], p[1]), Math.max(drag[0], p[0]), Math.max(drag[1], p[1])];
      coords.forEach((c, i) => { c.input.value = (state.box[i] * 100).toFixed(1); }); draw(); updateRun();
    };
    canvas.onpointerup = event => { if (drag) canvas.onpointermove(event); drag = null; };
    canvas.onpointercancel = () => { drag = null; };

    async function generate() {
      if (!validBox() || state.busy) return;
      try {
        const range = times();
        if (!prompt.value.trim()) throw new Error('가상 얼굴 설명을 입력하세요.');
        busy(true); result.hidden = true;
        const job = await jsonPost('/jobs', { upload_id: state.upload.id, ...range, box: state.box, prompt: prompt.value.trim() });
        state.job = { id: job.id, at: Date.now() }; remember(state.job);
        message('PC에서 테스트를 시작했어요. 준비와 생성에 시간이 걸릴 수 있어요.');
        poll();
      } catch (error) { busy(false); fail(error); }
    }
    async function poll() {
      if (!state.job || abort.signal.aborted) return;
      try {
        const job = await (await request(`/jobs/${encodeURIComponent(state.job.id)}`)).json();
        if (job.status === 'error') { remember(null); busy(false); throw new Error(job.error || '생성에 실패했어요. 구간이나 영역을 조정해 다시 시도하세요.'); }
        if (job.status === 'done') { await showResult(job); remember(null); busy(false); return; }
        const labels = { queued: '차례 기다리는 중', preparing: '테스트 구간 준비 중', generating: '가상 얼굴 생성 중', compositing: '결과 합성 중' };
        const elapsed = Math.floor((Date.now() - state.job.at) / 1000);
        message(`${labels[job.stage] || '처리 중'} · ${Math.floor(elapsed / 60)}분 ${elapsed % 60}초. 창을 닫아도 PC 작업은 계속되며 다시 열어 확인할 수 있어요.`);
        state.polling = setTimeout(poll, 2000);
      } catch (error) {
        if (error.name === 'AbortError') return;
        busy(false); fail(error);
        connection.replaceChildren(button('작업 상태 다시 확인', () => { busy(true); poll(); }));
      }
    }
    async function blobUrl(path) {
      const blob = await (await request(path)).blob();
      const url = URL.createObjectURL(blob); urls.add(url); return url;
    }
    async function showResult(job) {
      message('생성이 끝났어요. 비교 영상을 불러오는 중…');
      const [output, comparison] = await Promise.all([
        blobUrl(`/jobs/${encodeURIComponent(job.id)}/output`),
        blobUrl(`/jobs/${encodeURIComponent(job.id)}/comparison`),
      ]);
      if (abort.signal.aborted) return;
      const compareVideo = make('video', { src: comparison, controls: true, playsInline: true, preload: 'metadata' });
      const caption = help('왼쪽: 원본 · 오른쪽: 가상 얼굴 결과');
      result.replaceChildren(make('h3', { textContent: '테스트 결과' }), caption, compareVideo,
        make('div', { className: 'row' },
          button('전후 비교 보기', () => { compareVideo.pause(); compareVideo.src = comparison; caption.textContent = '왼쪽: 원본 · 오른쪽: 가상 얼굴 결과'; }),
          button('결과만 보기', () => { compareVideo.pause(); compareVideo.src = output; caption.textContent = '가상 얼굴 결과'; })),
        make('div', { className: 'row' },
          make('a', { className: 'btn', href: output, download: `vace-face-${job.id}.mp4`, textContent: '결과 영상 내려받기' }),
          make('a', { className: 'btn', href: comparison, download: `vace-compare-${job.id}.mp4`, textContent: '비교 영상 내려받기' })),
        help('고개 회전, 얼굴 가장자리, 눈·입의 흔들림을 재생해서 확인하세요. 갤러리 원본은 바뀌지 않았습니다.'));
      result.hidden = false;
      message('테스트 결과가 준비됐어요. 자연스러운지는 비교 영상을 보고 판단하세요.');
      result.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const old = remembered();
    renderChoices();
    if (old?.id) { state.job = old; busy(true); message('진행 중이던 작업을 확인하는 중…'); poll(); }
    else {
      if (file) choose(file);
      health();
    }
  }

  const header = document.querySelector('header');
  if (header && !document.getElementById('vaceOpen')) {
    const entry = button('가상 얼굴 테스트', () => open(), { id: 'vaceOpen', title: '이 PC의 VACE로 짧은 영상 테스트' });
    const edit = document.getElementById('mergeBtn');
    if (edit) edit.after(entry); else header.append(entry);
  }
  return { open };
})();
