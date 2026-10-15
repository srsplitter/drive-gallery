// 갤러리 페이지(srsplitter.github.io) 안에 들어간 플레이어 프레임에서만 동작.
// 갤러리가 수정 ON 이면, 영상을 클릭해 재생이 시작되는 순간 바로 멈춘다 (영상만 불러와 장면 찾기용).
// 갤러리의 ⏯ 버튼으로 재생한 경우(relay.js 의 framePlayer 가 __dgUserPlay 표시)는 멈추지 않는다.
const ancestors = location.ancestorOrigins;
if (window !== window.top && ancestors && ancestors.length && ancestors[ancestors.length - 1] === 'https://srsplitter.github.io') {
  let on = false;
  chrome.runtime.sendMessage({ type: 'autoPauseState' }, (res) => {
    void chrome.runtime.lastError;
    on = !!(res && res.on);
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'autoPause') on = !!msg.on;
  });
  // 미디어 이벤트는 버블링되지 않으므로 캡처 단계에서 받음.
  // 재생 직후 바로 멈추면 플레이어가 "시작 전" 화면(시간 조절바 없음)에 머물러서,
  // 실제 재생이 시작된 뒤 잠깐(0.3초) 있다가 멈춘다.
  document.addEventListener('playing', (e) => {
    const v = e.target;
    if (!on || window.__dgUserPlay || !(v instanceof HTMLMediaElement)) return;
    setTimeout(() => { if (on && !window.__dgUserPlay) v.pause(); }, 300);
  }, true);
  document.addEventListener('pause', () => { window.__dgUserPlay = false; }, true);
}
