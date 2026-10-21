// 모자이크 해제 도우미: 이 PC 의 Lada(lada-cli)를 갤러리 사이트가 쓸 수 있게 127.0.0.1 에서만 여는 작은 서버.
// 사이트가 드라이브에서 받은 영상을 조각으로 넘기면 → Lada 로 처리 → 결과를 조각으로 돌려줌. 드라이브 로그인은 사이트가 함(여긴 비밀키 없음).
// 실행: node tools/lada-helper.cjs   (또는 tools/lada-helper.bat)
// 환경 변수: LADA_CLI(lada-cli.exe 경로), LADA_WORK(임시 폴더), LADA_PORT
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LADA = process.env.LADA_CLI || 'C:\\Tools\\lada\\lada\\lada-cli.exe';
const WORK = process.env.LADA_WORK || 'C:\\Tools\\lada-work';
const PORT = Number(process.env.LADA_PORT || 7861);
// 이 주소의 페이지만 도우미를 쓸 수 있음 (다른 사이트가 몰래 부르지 못하게)
const ORIGINS = new Set(['https://srsplitter.github.io', 'http://localhost:8080']);
// H.264(어느 브라우저·폰에서나 재생) + 얼굴 모자이크는 감지해서 건드리지 않음
const ARGS = ['--detect-face-mosaics', '--encoder', 'h264_nvenc', '--encoder-options', '-preset p5 -tune hq -rc vbr -cq 20 -b:v 0'];

fs.mkdirSync(WORK, { recursive: true });
const jobs = new Map(); // id → { dir, input, output, size, received, state, progress, log, proc }

// 지난번에 남은 작업 폴더 정리 (도우미를 다시 켜면 이전 작업은 이어 갈 수 없음)
for (const name of fs.readdirSync(WORK)) if (/^[0-9a-f]{16}$/.test(name)) fs.rmSync(path.join(WORK, name), { recursive: true, force: true });

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(data);
}
function view(job) {
  return { state: job.state, progress: job.progress, received: job.received, size: job.size,
    outSize: job.state === 'done' ? fs.statSync(job.output).size : 0, error: job.error || '' };
}
function removeJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  const rm = () => fs.rm(job.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }, () => {});
  // 윈도우에선 Lada 가 쥐고 있는 파일을 못 지우므로, 멈추게 한 뒤 끝나면 지움
  if (job.proc) { job.proc.once('close', rm); spawn('taskkill', ['/pid', String(job.proc.pid), '/T', '/F'], { windowsHide: true }); } else rm(); // 딸린 ffmpeg 까지 같이 끔
}
function run(job) {
  job.state = 'running';
  job.progress = 0;
  const proc = spawn(LADA, ['--input', job.input, '--output', job.output, '--temporary-directory', job.dir, ...ARGS], { windowsHide: true });
  job.proc = proc;
  const onData = buf => {
    const text = buf.toString('latin1');
    job.log = (job.log + text).slice(-4000);
    const all = [...text.matchAll(/(\d{1,3})%\|/g)];
    if (all.length) job.progress = Math.min(100, Number(all[all.length - 1][1]));
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', code => {
    job.proc = null;
    if (!jobs.has(job.id)) return;
    fs.rm(job.input, { force: true }, () => {});
    if (code === 0 && fs.existsSync(job.output) && fs.statSync(job.output).size > 0) { job.state = 'done'; job.progress = 100; }
    else { job.state = 'failed'; job.error = `Lada 가 끝나지 못했어요 (코드 ${code})`; }
  });
  proc.on('error', e => { job.state = 'failed'; job.error = 'Lada 를 실행하지 못했어요: ' + e.message; });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return send(res, 403, 'forbidden');
  const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Range',
      'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length' });
    return res.end();
  }
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length');
  const url = new URL(req.url, 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  const job = parts[0] === 'jobs' && parts[1] ? jobs.get(parts[1]) : null;

  // GET /status → 도우미·Lada 가 준비됐는지
  if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, { ok: fs.existsSync(LADA), busy: [...jobs.values()].some(j => j.state === 'running') });

  // POST /jobs {size} → 새 작업 (영상은 PUT /jobs/:id/input 으로 차례로 받음)
  if (req.method === 'POST' && url.pathname === '/jobs') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let size;
      try { size = Number(JSON.parse(body).size); } catch { size = NaN; }
      if (!(size > 0)) return send(res, 400, 'size 가 필요해요');
      const id = crypto.randomBytes(8).toString('hex'), dir = path.join(WORK, id);
      fs.mkdirSync(dir);
      const j = { id, dir, input: path.join(dir, 'input.mp4'), output: path.join(dir, 'output.mp4'), size, received: 0, state: 'receiving', progress: 0, log: '', proc: null };
      fs.writeFileSync(j.input, '');
      jobs.set(id, j);
      send(res, 200, { id });
    });
    return;
  }
  if (!job) return send(res, 404, 'not found');

  // PUT /jobs/:id/input?offset=N → 받은 조각을 이어 씀. 다 받으면 바로 Lada 시작
  if (req.method === 'PUT' && parts[2] === 'input') {
    const offset = Number(url.searchParams.get('offset'));
    if (job.state !== 'receiving' || offset !== job.received) return send(res, 409, { expected: job.received });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (!jobs.has(job.id)) return send(res, 404, 'not found');
      const buf = Buffer.concat(chunks);
      if (job.received + buf.length > job.size) return send(res, 400, 'too large');
      fs.appendFileSync(job.input, buf);
      job.received += buf.length;
      if (job.received === job.size) run(job);
      send(res, 200, view(job));
    });
    return;
  }
  // GET /jobs/:id → 진행 상황
  if (req.method === 'GET' && parts.length === 2) return send(res, 200, view(job));
  // GET /jobs/:id/output (Range) → 결과 조각
  if (req.method === 'GET' && parts[2] === 'output') {
    if (job.state !== 'done') return send(res, 409, 'not ready');
    const total = fs.statSync(job.output).size;
    const m = /bytes=(\d+)-(\d+)?/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0, end = m && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start > end) return send(res, 416, 'range');
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}) });
    fs.createReadStream(job.output, { start, end }).pipe(res);
    return;
  }
  // DELETE /jobs/:id → 멈추고 임시 파일 지움
  if (req.method === 'DELETE' && parts.length === 2) { removeJob(job.id); return send(res, 200, { ok: true }); }
  send(res, 404, 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`모자이크 해제 도우미 준비됨: http://127.0.0.1:${PORT}  (Lada: ${LADA}, 임시 폴더: ${WORK})`);
  console.log('갤러리 사이트를 쓰는 동안 이 창을 켜 두세요. 끄려면 Ctrl+C.');
});
