// 헤더 [편집] → 영상 합치기 (수정 ON, PC 크롬·엣지).
// 필터·검색으로 영상을 찾고 썸네일을 누르면 누른 순서대로 담김 → 각 영상 아래 가위(✂)로 그 영상 앞 1초에 넣을 장면을 고름
// → 이름을 정하고 [합치기] → 드라이브에서 조금씩 읽어 합치고 조금씩 드라이브에 올림 → 다 올라간 걸 확인한 뒤에만 원본을 휴지통으로.
// index.html 의 전역(api, DRIVE, UPLOAD, token, tokenExp, AuthError, ensureWriteScope, items, renderGrid, openViewer, viewer,
// el, $, setStatus, trashVideo …)을 씀.
const MergeUI = (() => {
  let active = false, running = null; // running = { ctrl, url }
  let picks = []; // [{ f, intro: canvas|null, introUrl }]
  let nameDraft = '';
  const isPC = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && 'VideoEncoder' in window;

  function toggleMode() {
    if (running) return;
    active = !active;
    if (!active) picks = [];
    renderGrid();
  }
  function toggle(f) {
    if (running) return;
    const at = picks.findIndex(p => p.f.id === f.id);
    if (at >= 0) picks.splice(at, 1); else picks.push({ f, intro: null, introUrl: '' });
    renderGrid();
  }
  // 카드에 담긴 순서 번호
  function decorate(card, f) {
    if (!active) return;
    const at = picks.findIndex(p => p.f.id === f.id);
    if (at < 0) return;
    card.classList.add('merge-picked');
    card.querySelector('.thumb').append(el('span', { className: 'series-order-badge', textContent: String(at + 1) }));
  }

  // 가위: 영상 창을 열어 지점을 고르고 "이 지점으로 썸네일 설정" → 그 장면을 이 영상 앞 1초로
  function pickIntro(p) {
    window.mergePick = { f: p.f, done: canvas => {
      p.intro = canvas;
      try { p.introUrl = canvas.toDataURL('image/jpeg', 0.7); } catch { p.introUrl = ''; }
      window.mergePick = null;
      renderGrid();
    } };
    openViewer(p.f);
  }

  const NS = 'http://www.w3.org/2000/svg';
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
    box.hidden = !active;
    if (!active) return;
    if (running) return; // 진행 중엔 진행 표시를 그대로 둠
    const nameIn = el('input', { className: 'm-in', placeholder: '합친 영상 이름 (예: 겨울왕국 모음)', value: nameDraft,
      oninput: () => { nameDraft = nameIn.value; } });
    const list = el('div', { className: 'merge-list' }, ...picks.map((p, i) => {
      const move = d => () => { const j = i + d; if (j < 0 || j >= picks.length) return; [picks[i], picks[j]] = [picks[j], picks[i]]; renderGrid(); };
      const cut = el('button', { className: 'merge-cut' + (p.intro ? ' set' : ''), title: '이 영상 앞 1초에 넣을 장면 고르기', onclick: () => pickIntro(p) },
        p.introUrl ? el('img', { src: p.introUrl, alt: '' }) : scissors(), el('span', { textContent: p.intro ? '앞 1초 장면' : '앞 1초 장면 고르기' }));
      return el('div', { className: 'merge-item' },
        el('div', { className: 'merge-thumb' }, thumbOf(p.f), el('span', { className: 'series-order-badge', textContent: String(i + 1) })),
        el('div', { className: 'merge-name', textContent: p.f.name, title: p.f.name }),
        cut,
        el('div', { className: 'row merge-item-btns' },
          el('button', { className: 'small', textContent: '◀', title: '앞으로', disabled: i === 0, onclick: move(-1) }),
          el('button', { className: 'small', textContent: '▶', title: '뒤로', disabled: i === picks.length - 1, onclick: move(1) }),
          p.intro ? el('button', { className: 'small', textContent: '장면 빼기', onclick: () => { p.intro = null; p.introUrl = ''; renderGrid(); } }) : null,
          el('button', { className: 'small', textContent: '빼기', onclick: () => toggle(p.f) })));
    }));
    const go = el('button', { className: 'primary m-big', textContent: `${picks.length}개 합치기`, disabled: picks.length < 2, onclick: start });
    box.replaceChildren(...[
      el('div', { className: 'row' }, el('b', { textContent: '영상 합치기' }),
        el('span', { className: 'hint', textContent: '검색·필터로 영상을 찾고 썸네일을 누른 순서대로 담겨요. 다시 누르면 빠져요.' })),
      picks.length ? list : el('p', { className: 'hint', textContent: '아직 담은 영상이 없어요.' }),
      el('div', { className: 'm-sec' }, el('b', { textContent: '합친 영상 이름' }), nameIn),
      el('p', { className: 'hint', textContent: '합친 영상은 첫 영상이 있는 드라이브 폴더에 올라가고, 다 올라간 걸 확인한 뒤 원본은 드라이브 휴지통으로 옮겨져요(30일 안에 복원 가능). 해상도는 첫 영상에 맞추고, 합치는 동안 이 탭을 열어 두세요.' }),
      isPC() ? null : el('p', { className: 'hint error', textContent: '영상 합치기는 PC 크롬·엣지에서만 돼요.' }),
      el('div', { className: 'row' }, go, el('button', { textContent: '취소', onclick: toggleMode }))].filter(Boolean));
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

  // ---- 드라이브에 조금씩 올리기 (재개 가능 업로드). 조각은 256KB 배수, 드라이브가 위치를 확인함 ----
  const UNIT = 256 * 1024, CHUNK = 32 * UNIT; // 8MB
  async function driveUpload(meta, onSent, signal) {
    const r = await api(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size,mimeType,parents,thumbnailLink,videoMediaMetadata(durationMillis)`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify(meta) });
    const url = r.headers.get('Location');
    if (!url) throw new Error('드라이브 업로드 주소를 받지 못했어요.');
    running.url = url;
    let parts = [], buffered = 0, sent = 0, result = null;
    const take = n => { // 앞에서 n 바이트를 한 덩어리로
      const out = new Uint8Array(n);
      let at = 0;
      while (at < n) {
        const p = parts[0], k = Math.min(p.length, n - at);
        out.set(p.subarray(0, k), at);
        at += k;
        if (k === p.length) parts.shift(); else parts[0] = p.subarray(k);
      }
      buffered -= n;
      return out;
    };
    async function put(bytes, final) {
      const total = final ? sent + bytes.length : '*';
      const range = bytes.length ? `bytes ${sent}-${sent + bytes.length - 1}/${total}` : `bytes */${total}`;
      for (let tries = 0; ; tries++) {
        let res;
        try { res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': range }, body: bytes, signal }); }
        catch (e) { if (signal.aborted || tries >= 4) throw e; await sleep(2000 * (tries + 1)); continue; }
        if (res.status === 308 || res.ok) {
          if (res.ok) result = await res.json();
          sent += bytes.length;
          onSent(sent);
          return;
        }
        if (res.status >= 500 && tries < 4) { await sleep(2000 * (tries + 1)); continue; }
        throw new Error(`드라이브 업로드 실패 (${res.status})`);
      }
    }
    const writable = new WritableStream({
      async write(chunk) {
        const d = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        parts.push(d.slice()); // 엔진이 버퍼를 다시 쓸 수 있으니 복사
        buffered += d.length;
        while (buffered >= CHUNK) await put(take(CHUNK), false);
      },
      async close() { await put(take(buffered), true); },
    });
    return { writable, result: () => result, sent: () => sent };
  }

  // ---- 합치기 ----
  async function start() {
    if (running || picks.length < 2) return;
    if (!isPC()) return setStatus('영상 합치기는 PC 크롬·엣지에서만 돼요.', true);
    let name = (nameDraft || '').trim();
    if (!name) return setStatus('합친 영상 이름을 적어 주세요.', true);
    if (!/\.mp4$/i.test(name)) name += '.mp4';
    if (picks.some(p => !(+p.f.size > 0))) return setStatus('크기 정보가 없는 영상이 있어 합칠 수 없어요.', true);
    if (!await ensureWriteScope()) return;
    const list = picks.map(p => ({ ...p })), ctrl = new AbortController();
    running = { ctrl, url: null };
    const bar = el('div', { className: 'merge-bar' }, el('i'));
    const label = el('div', { className: 'hint' });
    const cancel = el('button', { textContent: '취소', onclick: () => ctrl.abort() });
    $('#mergePanel').replaceChildren(el('b', { textContent: `"${name}" 만드는 중` }), bar, label,
      el('p', { className: 'hint', textContent: '이 탭을 닫거나 새로고침하면 처음부터 다시 해야 해요. 원본은 다 올라간 뒤에만 휴지통으로 옮겨져요.' }), cancel);
    const guard = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', guard);
    let prog = { done: 0, total: 1, part: 0 }, up = 0;
    const show = () => {
      const pct = Math.min(100, prog.done / prog.total * 100);
      bar.firstChild.style.width = pct.toFixed(1) + '%';
      label.textContent = `${pct.toFixed(0)}% · ${prog.part + 1}/${list.length}번째 영상 · 올림 ${(up / 1e6).toFixed(0)}MB`;
    };
    try {
      const first = list[0].f;
      const upload = await driveUpload({ name, mimeType: 'video/mp4', parents: (first.parents || []).slice(0, 1) }, n => { up = n; show(); }, ctrl.signal);
      await VideoMerge.merge({
        parts: list.map(p => ({ name: p.f.name, size: +p.f.size, read: driveRead(p.f, ctrl.signal), intro: p.intro })),
        writable: upload.writable, signal: ctrl.signal, onProgress: p => { prog = p; show(); },
      });
      const made = upload.result();
      if (!made || !made.id || +made.size !== upload.sent()) throw new Error('드라이브에 다 올라갔는지 확인하지 못했어요. 원본은 그대로 두었어요.');
      running.url = null;
      // 다 올라간 걸 확인함 → 원본을 휴지통으로 (실패한 건 그대로 둠)
      label.textContent = '다 올렸어요. 원본을 휴지통으로 옮기는 중…';
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
      picks = [];
      nameDraft = '';
      active = false;
      running = null;
      renderGrid();
      setStatus(`"${made.name}" 을(를) 만들었어요. 원본 ${trashed}/${list.length}개를 드라이브 휴지통으로 옮겼어요(30일 안에 복원 가능).`
        + (trashed < list.length ? ' 옮기지 못한 원본은 그대로 있어요.' : ''), trashed < list.length);
    } catch (e) {
      const url = running && running.url;
      running = null;
      if (url) fetch(url, { method: 'DELETE' }).catch(() => {}); // 올리다 만 파일은 버림
      renderGrid();
      setStatus(e.name === 'AbortError' ? '합치기를 취소했어요. 원본은 그대로예요.' : '합치지 못했어요: ' + e.message + ' (원본은 그대로예요)', e.name !== 'AbortError');
    } finally {
      removeEventListener('beforeunload', guard);
    }
  }

  return { get active() { return active; }, get running() { return !!running; }, toggleMode, toggle, decorate, panel, isPC };
})();
