// 서비스 워커: 갤러리 탭의 요청을 받아
// - capture: 플레이어 프레임들의 컨트롤 등을 잠깐 숨기고 탭 화면을 찍어 돌려준다 (공유 허용 창 없음)
// - player : 플레이어 프레임의 영상에 재생/멈춤·시간 이동을 적용한다
// 드라이브 플레이어가 어떤 주소의 하위 프레임에서 영상을 재생하든 찾도록, 탭의 모든 하위 프레임에 직접 실행한다.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  if (!tab) return;
  // 플레이어 프레임(autopause.js)이 로드될 때 이 탭의 자동 멈춤 상태를 물어봄
  if (msg.type === 'autoPauseState') {
    const key = 'ap' + tab.id;
    chrome.storage.session.get(key).then((o) => sendResponse({ on: !!o[key] }), () => sendResponse({ on: false }));
    return true;
  }
  // 그 밖에는 갤러리 페이지(최상위 프레임)의 다리에서 온 요청만 처리
  if (sender.frameId !== 0 || !String(sender.url || '').startsWith('https://srsplitter.github.io/drive-gallery/')) return;

  if (msg.type === 'autoPause') {
    // 수정 ON/OFF → 이 탭의 플레이어 프레임들에 알리고, 나중에 로드될 프레임을 위해 저장
    chrome.storage.session.set({ ['ap' + tab.id]: !!msg.on });
    chrome.tabs.sendMessage(tab.id, { type: 'autoPause', on: !!msg.on }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'capture') {
    capture(tab).then(sendResponse, (e) => sendResponse({ ok: false, error: '캡처 실패: ' + (e && e.message || e) }));
    return true; // 비동기 응답
  }
  if (msg.type === 'player') {
    player(tab, msg.action, msg.delta).then(sendResponse, (e) => sendResponse({ ok: false, error: '플레이어 조작 실패: ' + (e && e.message || e) }));
    return true;
  }
});

function inFrames(tab, func, args) {
  return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func, args });
}

async function capture(tab) {
  await inFrames(tab, frameHideUi, [true]).catch(() => {});
  try {
    await new Promise((r) => setTimeout(r, 120)); // 숨긴 화면이 그려질 때까지
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } finally {
    await inFrames(tab, frameHideUi, [false]).catch(() => {});
  }
}

async function player(tab, action, delta) {
  const frames = (await inFrames(tab, framePlayer, [action, delta])).map((r) => r.result).filter(Boolean);
  const hit = frames.find((r) => r.acted);
  if (hit) return { ok: true, paused: hit.paused, time: hit.time, duration: hit.duration };
  const seen = frames.map((r) => `${r.where}(영상 ${r.videos})`).join(', ') || '하위 프레임 없음';
  return { ok: false, error: `플레이어 영상을 찾지 못했어요. 찾아본 프레임: ${seen}` };
}

// ↓ 아래 두 함수는 각 프레임 안에서 실행됨 (바깥 변수 사용 불가). 최상위(갤러리 페이지)에서는 아무것도 안 함.

// 찍는 순간 영상(<video>)과 하위 iframe 말고 모든 요소(컨트롤·제목·버튼)를 숨김 / 되돌림
function frameHideUi(hide) {
  if (window === window.top) return null;
  let s = document.getElementById('__dgallery_hide');
  if (hide && !s) {
    s = document.createElement('style');
    s.id = '__dgallery_hide';
    s.textContent = '* { visibility: hidden !important; }';
    (document.head || document.documentElement).append(s);
  }
  if (!hide && s) s.remove();
  // 영상·하위 iframe 은 Shadow DOM 안에 있어도 보이게 (페이지 스타일이 Shadow DOM 안까지는 안 닿으므로 직접 지정)
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'VIDEO' || el.tagName === 'IFRAME') {
        if (hide && !('__dgPrev' in el)) {
          el.__dgPrev = [el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')];
          el.style.setProperty('visibility', 'visible', 'important');
        } else if (!hide && '__dgPrev' in el) {
          el.style.setProperty('visibility', ...el.__dgPrev);
          delete el.__dgPrev;
        }
      }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return true;
}

// 이 프레임의 영상(Shadow DOM 안까지 찾음)에 재생/멈춤·시간 이동 적용
function framePlayer(action, delta) {
  if (window === window.top) return null;
  const found = [];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.tagName === 'VIDEO') found.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  const where = (location.hostname || location.protocol) + location.pathname.slice(0, 30);
  const v = found.find((x) => x.offsetWidth > 0 && x.offsetHeight > 0) || found[0];
  if (!v) return { where, videos: 0 };
  if (action === 'toggle') {
    // ⏯ 로 재생하는 건 자동 멈춤(autopause.js)에서 제외
    if (v.paused) { window.__dgUserPlay = true; v.play().catch(() => {}); } else v.pause();
  } else if (action === 'seek' || action === 'seekTo') { // seek: 상대 이동, seekTo: 그 시각으로
    v.pause();
    const end = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(Math.max(0, action === 'seek' ? v.currentTime + delta : delta), end);
  } // action === 'state': 상태만 알려줌
  return { where, videos: found.length, acted: true, paused: v.paused, time: v.currentTime,
    duration: Number.isFinite(v.duration) ? v.duration : 0 };
}
