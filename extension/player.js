// 드라이브 플레이어(갤러리 페이지 안에 iframe 으로 들어간 프레임)에서 실행.
// 갤러리 탭에서 온 요청만 서비스 워커를 거쳐 들어온다.
// - hideUi/showUi: 찍는 순간 영상(<video>) 말고 컨트롤·제목·버튼을 모두 숨겼다 되돌림
// - player: 재생/멈춤, 시간 이동
if (window !== window.top) {
  let style = null;

  const findVideo = () => {
    const all = [...document.querySelectorAll('video')];
    return all.find((v) => v.offsetWidth > 0 && v.offsetHeight > 0) || all[0] || null;
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'hideUi') {
      if (!style) {
        style = document.createElement('style');
        // 영상과, 영상이 들어 있을 수 있는 하위 iframe 만 보이게
        style.textContent = '* { visibility: hidden !important; } video, iframe { visibility: visible !important; }';
        (document.head || document.documentElement).append(style);
      }
      return;
    }
    if (msg.type === 'showUi') {
      if (style) { style.remove(); style = null; }
      return;
    }
    if (msg.type === 'player') {
      const v = findVideo();
      if (!v) return; // 다른 프레임이 응답하도록 넘김
      if (msg.action === 'toggle') {
        if (v.paused) v.play().catch(() => {}); else v.pause();
      } else if (msg.action === 'seek') {
        v.pause();
        const end = Number.isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.min(Math.max(0, v.currentTime + msg.delta), end);
      }
      sendResponse({ ok: true });
    }
  });
}
