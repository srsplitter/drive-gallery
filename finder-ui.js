// 헤더 [검색] 탭: 영상 이름(제목·출연자·날짜)으로 다른 사이트에 퍼진 같은 영상을 찾는 화면.
// 이 페이지는 Yandex 결과를 직접 읽을 수 없어서(다른 사이트), 이 PC 크롬의 "개인 영상 저장" 확장이 Yandex 검색 결과 페이지를
// 받아 넘겨 줌(확장 ON/OFF 와 무관, 이 브라우저의 Yandex 설정·로봇 확인이 그대로 적용). HTML 은 여기서 읽기만 하고 실행하지 않음.
// 웹 검색(성인 사이트까지 잘 나옴) + 동영상 검색(길이·썸네일이 있음)을 함께 돌려, 제목이 검색어와 많이 겹치는 순으로 정렬.
// index.html 전역(el, renderGrid, currentView)을 씀.
const FinderUI = (() => {
  const EXT = 'ipfhbkdamknanblcidakndcjcbajjoke';
  let query = '', state = 'idle', results = [], problem = '', extOk = null;

  // 확장에 묻기: 확장이 없거나 꺼져 있으면 null
  const ask = message => new Promise(resolve => {
    if (!window.chrome?.runtime?.sendMessage) return resolve(null);
    try { chrome.runtime.sendMessage(EXT, message, reply => { void chrome.runtime.lastError; resolve(reply || null); }); } catch { resolve(null); }
  });
  const words = text => String(text).toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // 검색어 낱말 중 제목에 들어 있는 비율 (0~1)
  const overlap = (title, q) => { const want = [...new Set(words(q))], have = new Set(words(title)); return want.length ? want.filter(w => have.has(w)).length / want.length : 0; };
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();

  function parseWeb(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('li.serp-item')].map(li => {
      const a = li.querySelector('a.OrganicTitle-Link');
      return a && { url: safeUrl(a.getAttribute('href')), title: text(a), snippet: text(li.querySelector('.OrganicText, .TextContainer')).slice(0, 200), from: 'web' };
    }).filter(r => r?.url);
  }
  function parseVideo(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('li.SearchBlock')].map(li => {
      const host = li.querySelector('a.VideoHostExtended-Host'), title = li.querySelector('.VideoSnippet-Title');
      if (!host || !title) return null;
      const duration = /^\d{1,2}(?::\d{2}){1,2}$/.exec(text(li.querySelector('a.VideoThumb3')))?.[0] || '';
      const poster = li.querySelector('video[poster]')?.getAttribute('poster') || li.querySelector('img[src^="http"]')?.getAttribute('src') || '';
      return { url: safeUrl(host.getAttribute('href')), title: text(title), duration, thumb: /^https:\/\/[^/]*yandex\.net\//.test(poster) ? poster : '', from: 'video' };
    }).filter(r => r?.url);
  }

  async function search(q) {
    query = q.trim();
    if (!query) return;
    state = 'searching'; problem = ''; results = []; renderGrid();
    const replies = await Promise.all(['web', 'video'].map(kind => ask({ type: 'yandex-search', kind, query })));
    if (replies.every(r => !r)) { extOk = false; state = 'error'; problem = 'noext'; return renderGrid(); }
    extOk = true;
    if (replies.some(r => r?.captcha)) { state = 'error'; problem = 'captcha'; return renderGrid(); }
    const found = [...(replies[0]?.html ? parseWeb(replies[0].html) : []), ...(replies[1]?.html ? parseVideo(replies[1].html) : [])];
    // 같은 주소는 하나로 (동영상 검색 쪽 길이·썸네일을 살림)
    const byUrl = new Map();
    for (const r of found) {
      const key = r.url.replace(/[?#].*$/, '').replace(/\/$/, '');
      byUrl.set(key, { ...byUrl.get(key), ...r, duration: r.duration || byUrl.get(key)?.duration || '', thumb: r.thumb || byUrl.get(key)?.thumb || '' });
    }
    results = [...byUrl.values()].map(r => ({ ...r, score: overlap(r.title, query) }))
      .sort((a, b) => b.score - a.score || Boolean(b.duration) - Boolean(a.duration));
    state = replies.some(r => r && !r.ok) && !results.length ? 'error' : 'done';
    if (state === 'error') problem = replies.find(r => r && !r.ok)?.error || 'Yandex 응답 오류';
    renderGrid();
  }

  function card(r) {
    const level = r.score >= 0.999 ? '제목 일치' : r.score >= 0.5 ? '일부 일치' : '';
    return el('a', { className: 'finder-item' + (r.score >= 0.999 ? ' match' : ''), href: r.url, target: '_blank', rel: 'noopener noreferrer' },
      r.thumb ? el('img', { src: r.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : el('div', { className: 'finder-noimg', textContent: hostOf(r.url).slice(0, 1).toUpperCase() }),
      el('div', { className: 'finder-body' },
        el('b', { textContent: r.title || hostOf(r.url) }),
        el('span', { className: 'finder-meta', textContent: [hostOf(r.url), r.duration, level].filter(Boolean).join(' · ') }),
        r.snippet ? el('span', { className: 'finder-snippet', textContent: r.snippet }) : null));
  }

  function view() {
    if (extOk === null) ask({ type: 'ping' }).then(reply => { extOk = Boolean(reply?.ok); if (currentView === 'finder') renderGrid(); });
    const input = el('input', { type: 'search', className: 'finder-input', value: query, placeholder: '영상 이름 · 출연자 (예: Gattouz0 2026-02-08)',
      onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) search(input.value); } });
    const status = state === 'searching' ? '검색 중…'
      : problem === 'noext' || extOk === false ? '이 브라우저에 "개인 영상 저장" 확장이 없거나 꺼져 있어요. 확장을 켠 크롬에서 열어 주세요.'
      : problem === 'captcha' ? 'Yandex 가 로봇 확인을 요구해요. 아래 버튼으로 Yandex 를 열어 확인을 마친 뒤 다시 검색하세요.'
      : state === 'error' ? `검색 실패: ${problem}`
      : state === 'done' ? `결과 ${results.length}개 · 제목이 검색어와 많이 겹치는 순` : 'Yandex 웹·동영상 검색으로 같은 영상을 찾아요.';
    const panel = el('div', { className: 'm-sec finder' },
      el('b', { textContent: '다른 곳에서 찾기 (Yandex)' }),
      el('div', { className: 'row' }, input,
        el('button', { className: 'primary', textContent: '검색', disabled: state === 'searching', onclick: () => search(input.value) })),
      el('p', { className: 'hint' + (state === 'error' || extOk === false ? ' error' : ''), textContent: status }),
      problem === 'captcha' ? el('a', { className: 'button', href: `https://yandex.com/search/?text=${encodeURIComponent(query)}`, target: '_blank', rel: 'noopener', textContent: 'Yandex 열기' }) : null);
    const exact = results.filter(r => r.score >= 0.999), rest = results.filter(r => r.score < 0.999);
    return el('div', { id: 'finderView' }, panel,
      exact.length ? el('h2', { className: 'section-title', textContent: `제목 일치 (${exact.length})` }) : null,
      exact.length ? el('div', { className: 'finder-list' }, ...exact.map(card)) : null,
      rest.length ? el('h2', { className: 'section-title', textContent: `그 밖의 결과 (${rest.length})` }) : null,
      rest.length ? el('div', { className: 'finder-list' }, ...rest.map(card)) : null);
  }

  return { view, search, parseWeb, parseVideo, overlap };
})();
