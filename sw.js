// 자체 플레이어용 부분 스트리밍.
// <video src="stream/<파일ID>?size=..&type=.."> 의 Range 요청을 드라이브 API 로 중계한다(인증 헤더 추가).
// 한 번에 최대 CHUNK 만큼만 받아오므로, 큰 영상도 보는/찾는 구간 근처만 내려받는다.
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
  e.respondWith(stream(m[1], +url.searchParams.get('size'), url.searchParams.get('type') || 'video/mp4', e.request));
});

async function stream(id, size, type, req) {
  const token = await getToken();
  if (!token) return new Response('login required', { status: 401 });
  if (!(size > 0)) return new Response('size required', { status: 400 });
  const r = /bytes=(\d+)-(\d*)/.exec(req.headers.get('Range') || '');
  const start = r ? +r[1] : 0;
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const end = Math.min(r && r[2] ? +r[2] : size - 1, start + CHUNK - 1, size - 1);
  const up = await fetch(`${DRIVE}/files/${id}?alt=media`, {
    headers: { Authorization: 'Bearer ' + token, Range: `bytes=${start}-${end}` },
    signal: req.signal,
  });
  if (up.status !== 206) {
    // 범위 요청이 무시되면(200) 파일 전체가 내려오므로 즉시 끊는다
    if (up.body) up.body.cancel();
    return new Response(null, { status: up.ok ? 502 : up.status });
  }
  return new Response(up.body, {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
