// lada-helper://start 를 열면 Windows 가 이걸 node.exe 로 실행함 (register-protocol.ps1 이 등록). 주소 내용은 읽지 않음.
// 도우미가 이미 7861 에서 듣고 있거나, 15초 안에 다른 클릭이 켜는 중이면 아무것도 안 함. 아니면 lada-helper.bat 을 새 창(최소화)으로 켬.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const listening = () => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: Number(process.env.LADA_PORT || 7861) });
  socket.setTimeout(1000);
  const done = v => { socket.destroy(); resolve(v); };
  socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
});

// 두 번 눌러 동시에 켜지면 하나만 진행 (켜는 데 잠깐 걸려서)
const LOCK = path.join(require('os').tmpdir(), 'lada-helper-launch.lock');
function claim() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try { if (Date.now() - fs.statSync(LOCK).mtimeMs < 15000) return false; fs.unlinkSync(LOCK); return claim(); } catch { return false; }
  }
}

(async () => {
  if (await listening() || !claim()) return;
  const bat = path.join(__dirname, 'lada-helper.bat');
  spawn('cmd.exe', ['/d', '/c', `start "모자이크 해제 도우미" /min /D "${__dirname}" cmd /c "${bat}"`],
    { cwd: __dirname, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
})();
