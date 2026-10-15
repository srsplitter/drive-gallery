// 드라이브 영상을 <video src="stream/<파일ID>?size=..&type=..[&play=1]"> 로 재생하기 위한 중계.
// <video> 의 Range 요청을 드라이브 API 로 넘기면서 인증 헤더를 붙인다.
// 응답은 항상 206 + 정확한 Content-Range/Content-Length 로 돌려준다 — 아이폰(WebKit)은 Range 를 물었는데 200 이 오면
// 그 영상을 재생하지 않는다(WebKit 버그 184447). 드라이브가 200 으로 통째로 주면 필요한 만큼만 잘라 206 으로 바꾼다.
// - 장면 지정(play 없음): 한 번에 최대 CHUNK 만큼만 받아오므로, 큰 영상도 찾는 구간 근처만 내려받는다.
// - 재생(play=1): 한 응답은 PLAY_CHUNK 경계까지만 주되(아이폰에서 검증된 작은 응답), 이어지는 조각 AHEAD 개를 미리 요청해 둔다.
//   요청마다 드라이브 응답 대기(0.5~1초)가 붙는데, 미리 받아 두면 플레이어가 다음 조각을 물을 때 바로 흘려보낼 수 있어
//   고화질 영상도 끊기지 않는다. 미리 받은 조각은 60초 안에 안 쓰이거나 다른 영상을 열면 버린다.
// - stream/_log: 최근 중계 기록(진단용). 페이지가 재생 실패 안내에 붙여 보여준다.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const CHUNK = 4 * 1024 * 1024;
const PLAY_CHUNK = 4 * 1024 * 1024; // 아이폰에서 재생이 확인된 응답 크기
const AHEAD = 4; // 미리 받아 둘 조각 수 (최대 16MB 가 워커 메모리에 머묾)
const PREFETCH_TTL = 60 * 1000;
let auth = null; // { token, exp }
const prefetches = new Map(); // `${id}:${start}` → { id, t, ctrl, p: Promise<Response> } (start 은 PLAY_CHUNK 경계)
const log = []; // 최근 12건: { id, range, out, up, pre, ms }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 페이지가 로그인 토큰을 넘겨준다(빈 메시지 = 로그아웃). 워커가 재시작돼도 쓰도록 캐시에도 보관.
self.addEventListener('message', e => {
  auth = e.data && e.data.token ? { token: e.data.token, exp: e.data.exp } : null;
  e.waitUntil(caches.open('auth').then(c => auth ? c.put('token', new Response(JSON.stringify(auth))) : c.delete('token')));
});

async function getToken() {
  if (!auth) {
    const r = await (await caches.open('auth')).match('token');
    if (r) auth = await r.json();
  }
  return auth && auth.exp > Date.now() ? auth.token : null;
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/\/stream\/([\w-]+)$/);
  if (url.origin !== location.origin || !m) return;
  if (m[1] === '_log') return e.respondWith(new Response(JSON.stringify(log), { headers: { 'Content-Type': 'application/json' } }));
  e.respondWith(stream(m[1], +url.searchParams.get('size'), url.searchParams.get('type') || 'video/mp4', e.request,
    !!url.searchParams.get('play')));
});

function fetchRange(token, id, start, end, signal) {
  return fetch(`${DRIVE}/files/${id}?alt=media`, { headers: { Authorization: 'Bearer ' + token, Range: `bytes=${start}-${end}` }, signal });
}

// 앞에서부터 n 바이트만 흘려보내고 나머지는 끊는다(원본 스트림도 취소됨)
function limit(body, n) {
  let left = n;
  return body.pipeThrough(new TransformStream({
    transform(chunk, c) {
      if (left <= 0) return;
      if (chunk.byteLength > left) chunk = chunk.subarray(0, left);
      left -= chunk.byteLength;
      c.enqueue(chunk);
      if (left <= 0) c.terminate();
    },
  }));
}

function drop(key) {
  const e = prefetches.get(key);
  if (e) { e.ctrl.abort(); prefetches.delete(key); }
}
// 다른 영상 것이거나 오래된 미리 받기는 버린다
function sweep(id) {
  const now = Date.now();
  for (const [key, e] of prefetches) if (e.id !== id || now - e.t > PREFETCH_TTL) drop(key);
}
function takePrefetch(id, start) {
  sweep(id);
  const key = `${id}:${start}`, e = prefetches.get(key);
  if (e) prefetches.delete(key);
  return e || null;
}
// from(PLAY_CHUNK 경계)부터 AHEAD 개 조각을 미리 요청해 둔다
function prefetch(token, id, from, size) {
  sweep(id);
  for (let s = from, n = 0; s < size && n < AHEAD; s += PLAY_CHUNK, n++) {
    const key = `${id}:${s}`;
    if (prefetches.has(key)) continue;
    const ctrl = new AbortController();
    const e = { id, t: Date.now(), ctrl, p: fetchRange(token, id, s, Math.min(s + PLAY_CHUNK - 1, size - 1), ctrl.signal) };
    e.p.catch(() => { if (prefetches.get(key) === e) prefetches.delete(key); });
    prefetches.set(key, e);
  }
  while (prefetches.size > AHEAD + 1) drop(prefetches.keys().next().value);
}

async function stream(id, size, type, req, play) {
  const token = await getToken();
  if (!token) return new Response('login required', { status: 401 });
  if (!(size > 0)) return new Response('size required', { status: 400 });
  const r = /bytes=(\d+)-(\d*)/.exec(req.headers.get('Range') || '');
  const start = r ? +r[1] : 0;
  const reqEnd = r && r[2] ? Math.min(+r[2], size - 1) : size - 1;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  // 재생: 다음 PLAY_CHUNK 경계까지(미리 받은 조각과 맞물리게). 장면 지정: CHUNK 까지
  const chunkEnd = play ? (Math.floor(start / PLAY_CHUNK) + 1) * PLAY_CHUNK - 1 : start + CHUNK - 1;
  let end = Math.min(reqEnd, chunkEnd, size - 1);
  const t0 = Date.now();
  const pre = play ? takePrefetch(id, start) : null;
  let up = pre ? await pre.p.catch(() => null) : null;
  if (!up) up = await fetchRange(token, id, start, end, req.signal);
  if (play) prefetch(token, id, (Math.floor(end / PLAY_CHUNK) + 1) * PLAY_CHUNK, size);
  log.push({ id: id.slice(-6), range: `${start}-${r && r[2] ? r[2] : ''}`, out: `${start}-${end}`, up: up.status, pre: !!pre, ms: Date.now() - t0 });
  if (log.length > 12) log.shift();
  // 206 이 아니면서 처음부터 통째로 주는 200 도 아니면(중간부터 물었는데 200 등) 즉시 끊는다
  if (up.status !== 206 && !(up.status === 200 && start === 0)) {
    if (up.body) up.body.cancel();
    return new Response(null, { status: up.ok ? 502 : up.status });
  }
  // 드라이브가 요청보다 덜 줬으면(206 의 길이) 그만큼만 범위로 잡고, 더 주면(200·미리 받은 조각) 필요한 만큼만 잘라 보낸다
  const len = up.status === 206 ? +up.headers.get('Content-Length') || 0 : 0;
  if (len && len < end - start + 1) end = start + len - 1;
  const want = end - start + 1;
  return new Response(limit(up.body, want), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(want),
      'Accept-Ranges': 'bytes',
    },
  });
}
