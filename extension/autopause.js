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

  // 드라이브 시간표의 미리보기는 실제 이동 위치보다 1초 앞 장면이라, 시간표를 클릭(끌어 놓기)해 이동하면 1초 되돌린다.
  // 갤러리의 시간 조절바·±버튼(relay.js framePlayer 가 __dgOwnSeek 표시)과 키보드 이동은 그대로 둔다.
  let lastPointer = 0;
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(t, () => { lastPointer = Date.now(); }, true);
  }
  document.addEventListener('seeking', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement)) return;
    if (window.__dgOwnSeek) { window.__dgOwnSeek = false; return; }
    if (!on || Date.now() - lastPointer > 1500 || v.currentTime < 1) return;
    lastPointer = 0; // 클릭 한 번에 한 번만
    window.__dgOwnSeek = true; // 아래 되돌리기가 다시 여기로 들어와도 무시
    setTimeout(() => { window.__dgOwnSeek = false; }, 1000);
    v.currentTime -= 1;
  }, true);
}
