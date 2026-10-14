// 갤러리 페이지(srsplitter.github.io/drive-gallery)와 확장을 잇는 다리.
// 페이지의 캡처·플레이어 조작 요청을 서비스 워커로 넘기고, 결과를 페이지에 되돌려준다.
window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== 'dgallery-page') return;

  if (d.type === 'ping') {
    window.postMessage({ source: 'dgallery-ext', type: 'ready' }, location.origin);
    return;
  }

  if (d.type === 'capture' || d.type === 'player') {
    const reply = (res) => window.postMessage(Object.assign({ source: 'dgallery-ext', type: 'result', id: d.id, ok: false }, res), location.origin);
    try {
      chrome.runtime.sendMessage({
        type: d.type,
        action: typeof d.action === 'string' ? d.action : '',
        delta: typeof d.delta === 'number' ? d.delta : 0
      }, (res) => {
        const err = chrome.runtime.lastError;
        reply(res || { error: err ? '확장과 연결에 실패했어요. 확장을 다시 로드해 주세요.' : '응답 없음' });
      });
    } catch {
      // 확장을 새로고침(↻)하면 이미 열려 있던 페이지의 이 스크립트는 끊긴다
      reply({ error: '확장 프로그램이 업데이트됐어요. 이 페이지를 새로고침(Ctrl+Shift+R)해 주세요.' });
    }
  }
});

// 설치되어 있음을 페이지에 알림
window.postMessage({ source: 'dgallery-ext', type: 'ready' }, location.origin);
