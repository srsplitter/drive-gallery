// 자동 썸네일 길이: 영상 길이의 0.1%(최소 1초, 초 단위 올림). VideoMerge 가 introSec 만큼 썸네일을 넣는지 실제 인코딩으로 확인.
const { chromium } = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-len-'));
const sample = path.join(dir, 's.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample]);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'gallery.test') return route.abort();
    if (u.pathname === '/sample.mp4') return route.fulfill({ contentType: 'video/mp4', body: fs.readFileSync(sample) });
    const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: /\.m?js$/.test(file) ? 'application/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(file) });
  });
  try {
    await page.goto('https://gallery.test/');
    const dur = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch('/sample.mp4')).arrayBuffer());
      const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').fillRect(0, 0, 320, 180);
      const run = async introSec => (await VideoMerge.merge({ parts: [{ name: 's', size: bytes.length, read: async (s, e) => bytes.slice(s, e), intro: c, introSec }], writable: new WritableStream({ write() {} }) })).duration;
      return [await run(undefined), await run(3), await run(d => Math.max(1, Math.ceil(d / 1000)) + 1)];
    });
    assert.ok(Math.abs(dur[0] - 5) < 0.2, 'default 1s: ' + dur);
    assert.ok(Math.abs(dur[1] - 7) < 0.2, 'introSec 3: ' + dur);
    assert.ok(Math.abs(dur[2] - 6) < 0.2, 'introSec from length: ' + dur);
    console.log('intro-length-browser: ok', dur);
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
