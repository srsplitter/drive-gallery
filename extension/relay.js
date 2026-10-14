// 서비스 워커: 갤러리 탭의 요청을 받아
// - capture: 플레이어 프레임들의 컨트롤 등을 잠깐 숨기고 탭 화면을 찍어 돌려준다 (공유 허용 창 없음)
// - player : 플레이어 프레임에 재생/멈춤·시간 이동을 전달한다
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tab = sender.tab;
  // 갤러리 페이지(최상위 프레임)의 다리에서 온 요청만 처리
  if (!tab || sender.frameId !== 0 || !String(sender.url || '').startsWith('https://srsplitter.github.io/drive-gallery/')) return;

  if (msg.type === 'capture') {
    capture(tab).then(sendResponse, (e) => sendResponse({ ok: false, error: '캡처 실패: ' + (e && e.message || e) }));
    return true; // 비동기 응답
  }
  if (msg.type === 'player') {
    chrome.tabs.sendMessage(tab.id, { type: 'player', action: msg.action, delta: msg.delta })
      .then((res) => sendResponse(res && res.ok ? { ok: true } : { ok: false, error: '플레이어를 찾지 못했어요. 영상을 한 번 재생해 보세요.' }))
      .catch(() => sendResponse({ ok: false, error: '플레이어를 찾지 못했어요.' }));
    return true;
  }
});

async function capture(tab) {
  // 탭의 모든 프레임에 전달됨 → 플레이어 프레임들이 영상 외 요소를 숨김
  await chrome.tabs.sendMessage(tab.id, { type: 'hideUi' }).catch(() => {});
  try {
    await new Promise((r) => setTimeout(r, 120)); // 숨긴 화면이 그려질 때까지
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { ok: true, dataUrl };
  } finally {
    await chrome.tabs.sendMessage(tab.id, { type: 'showUi' }).catch(() => {});
  }
}
