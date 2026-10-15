// 드라이브 영상을 <video src="stream/<파일ID>?size=..&type=..[&play=1]"> 로 재생하기 위한 중계.
// <video> 의 Range 요청을 드라이브 API 로 넘기면서 인증 헤더를 붙인다.
// - 장면 지정(play 없음): 한 번에 최대 CHUNK 만큼만 받아오므로, 큰 영상도 찾는 구간 근처만 내려받는다.
// - 재생(play=1): 플레이어가 요청한 범위를 자르지 않고 그대로 올려 한 번의 응답으로 이어서 받는다.
//   요청마다 드라이브 응답 대기(0.5~1초)가 붙어서 조각내면 고화질 영상이 자꾸 끊긴다.
//   플레이어(아이폰 AVFoundation 등)가 버퍼가 차면 스스로 끊고 이어서 다시 요청하므로 통째로 받지는 않는다.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const CHUNK = 4 * 1024 * 1024;
let auth = null; // { token, exp }

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
  e.respondWith(stream(m[1], +url.searchParams.get('size'), url.searchParams.get('type') || 'video/mp4', e.request,
    !!url.searchParams.get('play')));
});

async function stream(id, size, type, req, play) {
  const token = await getToken();
  if (!token) return new Response('login required', { status: 401 });
  if (!(size > 0)) return new Response('size required', { status: 400 });
  const r = /bytes=(\d+)-(\d*)/.exec(req.headers.get('Range') || '');
  const start = r ? +r[1] : 0;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const headers = { Authorization: 'Bearer ' + token };
  if (play) {
    // 재생: 플레이어가 보낸 Range 그대로(끝이 비어 있으면 끝까지). Range 가 없으면 파일 전체(200)
    if (r) headers.Range = `bytes=${start}-${r[2]}`;
  } else {
    headers.Range = `bytes=${start}-${Math.min(r && r[2] ? +r[2] : size - 1, start + CHUNK - 1, size - 1)}`;
  }
  const up = await fetch(`${DRIVE}/files/${id}?alt=media`, { headers, signal: req.signal });
  // 재생에서 Range 없이 물었거나 드라이브가 처음부터 통째로 주면(200) 그대로 통과. 중간부터 물었는데 200 이면 전체가 내려오므로 즉시 끊는다
  const whole = up.status === 200 && play && start === 0;
  if (up.status !== 206 && !whole) {
    if (up.body) up.body.cancel();
    return new Response(null, { status: up.ok ? 502 : up.status });
  }
  // 범위·길이는 드라이브 응답 헤더를 그대로 통과(없으면 요청한 범위로 채움)
  const out = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  const len = up.headers.get('Content-Length');
  if (len) out['Content-Length'] = len;
  if (up.status === 206) {
    out['Content-Range'] = up.headers.get('Content-Range') || `bytes ${start}-${len ? start + +len - 1 : size - 1}/${size}`;
  }
  return new Response(up.body, { status: up.status, headers: out });
}
