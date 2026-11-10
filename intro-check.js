// 맨 앞 1초 썸네일을 넣은 영상(gallery.intro)이 드라이브에서도 같은 썸네일로 보이는지 그림을 비교.
// 같다고 확인된 영상만 "작업 끝"(빗금 없음, 자동 썸네일 목록에서 빠짐). 다르거나 아직 확인 못 하면 빗금 그대로 → 다시 작업 가능.
// 같다는 결과만 이 브라우저(localStorage)에 기억. 지정 썸네일이나 드라이브 썸네일이 바뀌면 다시 비교함.
// 드라이브 썸네일(lh3)은 CORS 를 안 열어 줘 페이지가 픽셀을 못 읽음 → 확장 프로그램(2.1+)이 대신 받아 줌.
// 확장이 없거나(폰 등) 그림을 못 받으면 비교하지 않고 예전처럼 '넣었음' 기록만 봄 (전부 빗금이 되어 다시 작업에 들어가는 일 방지)
// index.html 전역(gallery, items, thumbUrl, renderGrid)과 MergeUI 를 씀.
const IntroCheck = (() => {
  const KEY = 'introMatch', UP_KEY = 'introUploaded', UP_MAX = 6 * 3600 * 1000, SIZE = 32, PASS = 0.8, WORKERS = 3;
  let same = {};
  try { same = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  let up = {}; // 덮어 올린 영상: id → { v: 올리기 전 드라이브 썸네일 버전, t: 올린 시각 }
  try { up = JSON.parse(localStorage.getItem(UP_KEY) || '{}') || {}; } catch {}
  const saveUp = () => { try { localStorage.setItem(UP_KEY, JSON.stringify(up)); } catch {} };
  const notSame = new Map(); // 이번 접속에서 다르다고 나온 것: id → sign
  const failed = new Map(); // 이번 접속에서 그림을 못 읽은 것: id → sign (기록만 봄)
  const canCompare = () => typeof extReady !== 'undefined' && extReady && +String(extVersion).split('.')[0] * 100 + +(String(extVersion).split('.')[1] || 0) >= 201;
  const scores = new Map(); // id → 일치도 (카드에 마우스를 올리면 보임)
  const queue = new Map();
  let running = 0, dirty = false;

  const sign = f => {
    const c = gallery.videos[f.id];
    if (!c || !f.thumbnailLink) return '';
    return `${f.thumbnailVersion || ''}|${c.file || (c.thumb || '').length + (c.thumb || '').slice(-24)}`;
  };
  const flagged = f => !!(gallery.intro || {})[f.id];
  const done = f => {
    if (!flagged(f)) return false;
    if (!canCompare()) return true;
    const s = sign(f);
    return !!s && (same[f.id] === s || failed.get(f.id) === s);
  };
  // 덮어 올린 뒤 드라이브가 아직 새 썸네일을 안 만듦 (버전이 바뀌면 끝. 안 바뀌어도 UP_MAX 뒤엔 끝난 걸로)
  function justUploaded(f) {
    const u = up[f.id];
    if (!u) return false;
    if (u.v === (f.thumbnailVersion || '') && Date.now() - u.t < UP_MAX) return true;
    delete up[f.id];
    saveUp();
    return false;
  }
  // 드라이브가 저장·변환 중이라 재생도 썸네일도 아직 안 되는 영상 → 자동 썸네일 대기열에서 뺌
  const processing = f => !f.thumbnailLink || !(f.videoMediaMetadata && +f.videoMediaMetadata.durationMillis) || justUploaded(f);

  const image = (src, cors) => new Promise((ok, bad) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('그림을 못 읽음'));
    im.src = src;
  });
  // 비교 칸(SIZE×SIZE)의 밝기 값. frame: 드라이브 썸네일 비율 → 영상에 넣을 때처럼 검은 바탕 가운데에 맞춰 그림
  function gray(img, frame) {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000';
    x.fillRect(0, 0, SIZE, SIZE);
    if (frame) {
      const k = Math.min(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
      const dw = img.naturalWidth * k * SIZE / frame.w, dh = img.naturalHeight * k * SIZE / frame.h;
      x.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    } else x.drawImage(img, 0, 0, SIZE, SIZE);
    const d = x.getImageData(0, 0, SIZE, SIZE).data, out = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  }
  // 두 그림의 닮은 정도 (상관계수 -1~1). 한쪽이 단색이면 판단할 수 없어 0
  function similarity(a, b) {
    const n = a.length;
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
    return aa < 1 || bb < 1 ? 0 : ab / Math.sqrt(aa * bb);
  }
  async function compare(f) {
    const c = gallery.videos[f.id];
    const [drive, mine] = await Promise.all([
      extCall('thumb', { url: f.thumbnailLink.replace(/=s\d+$/, '=s128') }, 15000).then(r => image(r.data)),
      c.thumb ? image(c.thumb) : thumbUrl(c.file).then(u => image(u)),
    ]);
    return similarity(gray(drive), gray(mine, { w: drive.naturalWidth, h: drive.naturalHeight }));
  }

  function finishBatch() {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(same)); } catch {}
    if (MergeUI.active && MergeUI.tab === 'auto') return renderGrid();
    for (const card of document.querySelectorAll('.card[data-id]')) {
      const f = items.find(x => x.id === card.dataset.id);
      if (f) paint(card, f);
    }
  }
  function paint(card, f) {
    card.classList.toggle('no-intro', !done(f));
    const name = card.querySelector(':scope > .name:not(.dur-line)');
    if (name && scores.has(f.id)) name.title = `드라이브 썸네일 일치도 ${Math.round(scores.get(f.id) * 100)}%`;
  }
  async function work() {
    running++;
    for (let f; (f = queue.values().next().value);) {
      queue.delete(f.id);
      const s = sign(f);
      if (!s || !canCompare() || same[f.id] === s || failed.get(f.id) === s || notSame.get(f.id) === s) continue;
      try {
        const score = await compare(f);
        scores.set(f.id, score);
        if (score >= PASS) { same[f.id] = s; notSame.delete(f.id); dirty = true; } else { delete same[f.id]; notSame.set(f.id, s); dirty = true; }
      } catch { failed.set(f.id, s); dirty = true; }
    }
    if (!--running) finishBatch();
  }
  // 넣었다고 기록된 영상이면 비교 줄에 올림 (같은 조건에서 이미 다르다고 나온 건 다시 안 함)
  function want(f) {
    const s = sign(f);
    if (!flagged(f) || !s || !canCompare() || same[f.id] === s || failed.get(f.id) === s || justUploaded(f) || notSame.get(f.id) === s || queue.has(f.id)) return;
    queue.set(f.id, f);
    if (running < WORKERS) setTimeout(() => { if (running < WORKERS && queue.size) work(); }, 0);
  }
  let lastBusy = '';
  function recheck() {
    items.forEach(want);
    const busy = items.filter(processing).map(f => f.id).join();
    if (busy !== lastBusy) { lastBusy = busy; dirty = true; if (!running && !queue.size) finishBatch(); }
  }
  // 다시 올렸음 → 예전 결과를 버리고, 드라이브가 새 썸네일을 만들 때까지 기다림
  function uploaded(f) {
    delete same[f.id]; notSame.delete(f.id); failed.delete(f.id); scores.delete(f.id); dirty = true;
    up[f.id] = { v: f.thumbnailVersion || '', t: Date.now() };
    saveUp();
  }

  return { done, processing, want, recheck, uploaded, similarity };
})();
