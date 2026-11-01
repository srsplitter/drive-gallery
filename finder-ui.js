// 헤더 [검색] 탭: 다른 사이트에 퍼진 같은 영상을 찾는 화면.
// 1) 이름(제목·출연자·날짜)으로 Yandex 웹·동영상 검색 → 제목이 검색어와 많이 겹치는 순.
// 2) 영상 링크를 넣으면 PC 의 영상 저장 프로그램이 25·50·75% 장면 3장을 뽑고(이름 칸이 비었으면 영상 제목으로 이름 검색),
//    제목 일치가 없으면 장면 3장으로 Yandex 이미지 검색 → "비슷한 장면 N/3".
//    Yandex 이미지 검색의 "사이트"는 같은 장면뿐 아니라 닮은 사람·비슷한 배경도 섞여 나오고(같은 사람이 나오면 장면마다 똑같이 나옴),
//    점수도 주지 않음 → 장면만으로는 같은 영상이라 하지 않고, 제목이 검색어와 30% 이상 겹칠 때만 "가능성 높음"에 올림.
// 이 페이지는 Yandex·다른 사이트 영상을 직접 읽을 수 없어서(다른 사이트), 이 PC 크롬의 "개인 영상 저장" 확장이 대신 받아 넘겨 줌
// (확장 ON/OFF 와 무관, 이 브라우저의 Yandex 설정·로봇 확인이 그대로 적용). 받은 HTML 은 여기서 읽기만 하고 실행하지 않음.
// index.html 전역(el, renderGrid, currentView)을 씀.
const FinderUI = (() => {
  const EXT = 'ipfhbkdamknanblcidakndcjcbajjoke';
  let query = '', link = '', state = 'idle', status = '', problem = '', extOk = null;
  let frames = []; // { at, src }
  const found = new Map(); // 주소 → { url, title, snippet, duration, thumb, scenes: Set(장면 번호) }

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
  const yandexThumb = value => { const url = safeUrl(String(value || '').replace(/^\/\//, 'https://')); return /^https:\/\/[^/]*yandex\.net\//.test(url) ? url : ''; };
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const keyOf = url => url.replace(/[?#].*$/, '').replace(/\/$/, '');
  const fmt = sec => { const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = Math.floor(sec % 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(s).padStart(2, '0'); };

  function parseWeb(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('li.serp-item')].map(li => {
      const a = li.querySelector('a.OrganicTitle-Link');
      return a && { url: safeUrl(a.getAttribute('href')), title: text(a), snippet: text(li.querySelector('.OrganicText, .TextContainer')).slice(0, 200) };
    }).filter(r => r?.url);
  }
  function parseVideo(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('li.SearchBlock')].map(li => {
      const host = li.querySelector('a.VideoHostExtended-Host'), title = li.querySelector('.VideoSnippet-Title');
      if (!host || !title) return null;
      const duration = /^\d{1,2}(?::\d{2}){1,2}$/.exec(text(li.querySelector('a.VideoThumb3')))?.[0] || '';
      const poster = li.querySelector('video[poster]')?.getAttribute('poster') || li.querySelector('img[src]')?.getAttribute('src');
      return { url: safeUrl(host.getAttribute('href')), title: text(title), duration, thumb: yandexThumb(poster) };
    }).filter(r => r?.url);
  }
  // 이미지 검색 결과 페이지: "이 이미지가 있는 사이트" 목록은 페이지에 실린 상태 JSON(initialState.cbirSites.sites)에 있음
  function parseImage(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const node of doc.querySelectorAll('[data-state]')) {
      let sites;
      try { sites = JSON.parse(node.getAttribute('data-state'))?.initialState?.cbirSites?.sites; } catch { continue; }
      // 관련도 순이라 뒤쪽은 거의 무관한 결과: 장면마다 앞 40개만
      if (Array.isArray(sites)) return sites.slice(0, 40).map(s => ({ url: safeUrl(s?.url), title: String(s?.title || ''), snippet: String(s?.description || '').slice(0, 200), thumb: yandexThumb(s?.thumb?.url) })).filter(r => r.url);
    }
    return [];
  }
  function add(list, scene) {
    for (const r of list) {
      const key = keyOf(r.url), old = found.get(key) || { scenes: new Set() };
      found.set(key, { ...old, ...r, title: old.title || r.title, snippet: old.snippet || r.snippet || '', duration: old.duration || r.duration || '', thumb: old.thumb || r.thumb || '' });
      if (scene !== undefined) found.get(key).scenes.add(scene);
    }
  }
  // 같은 영상일 가능성 높음: 제목 일치, 또는 비슷한 장면이 있고 제목이 30% 이상 겹침
  const likely = r => r.score >= 0.999 || (r.scenes.size > 0 && r.score >= 0.3);
  const results = () => [...found.values()].map(r => ({ ...r, score: overlap(r.title, query) }))
    .sort((a, b) => likely(b) - likely(a) || (b.score >= 0.999) - (a.score >= 0.999) || b.score - a.score || b.scenes.size - a.scenes.size || Boolean(b.duration) - Boolean(a.duration));
  const fail = (reply, what) => {
    if (!reply) { extOk = false; problem = 'noext'; return true; }
    if (reply.captcha) { problem = 'captcha'; return true; }
    if (reply.ok === false) { problem = reply.error || `${what} 실패`; return true; }
    return false;
  };

  async function nameSearch() {
    if (!query) return;
    state = 'busy'; status = `"${query}" 이름으로 찾는 중…`; renderGrid();
    const replies = await Promise.all(['web', 'video'].map(kind => ask({ type: 'yandex-search', kind, query })));
    if (replies.every(r => fail(r, '이름 검색'))) return;
    problem = ''; extOk = true;
    add(replies[0]?.html ? parseWeb(replies[0].html) : []);
    add(replies[1]?.html ? parseVideo(replies[1].html) : []);
  }
  async function imageSearch() {
    for (const [i, frame] of frames.entries()) {
      state = 'busy'; status = `장면 ${i + 1}/${frames.length} (${fmt(frame.at)}) 이미지로 찾는 중…`; renderGrid();
      const reply = await ask({ type: 'yandex-image', jpeg: frame.src.split(',')[1] });
      if (fail(reply, '이미지 검색')) return;
      add(reply.html ? parseImage(reply.html) : [], i);
    }
  }
  const finish = () => { state = problem ? 'error' : 'done'; status = ''; renderGrid(); };

  async function search(name) {
    query = name.trim(); found.clear(); problem = '';
    await nameSearch(); finish();
  }
  // source: { url } (링크 칸) 또는 { ticket } (확장 패널의 [찾기]: 플레이어에 숨은 영상도 확장이 찾아 둔 것이라 됨)
  async function searchLink(value, name, source = { url: value.trim() }) {
    link = value.trim(); query = name.trim(); found.clear(); frames = []; problem = '';
    if (!source.url && !source.ticket) return;
    state = 'busy'; status = '영상에서 25·50·75% 장면을 뽑는 중… (PC 의 영상 저장 프로그램)'; renderGrid();
    const reply = await ask({ type: 'frames', ...source });
    if (fail(reply, '장면 뽑기')) return finish();
    frames = (reply.frames || []).map(f => ({ at: f.at, src: 'data:image/jpeg;base64,' + f.jpeg }));
    if (!query && reply.title) query = reply.title;
    await nameSearch();
    if (!problem && !results().some(r => r.score >= 0.999)) await imageSearch();
    finish();
  }
  async function scenesOnly() {
    if (!frames.length) return;
    problem = ''; await imageSearch(); finish();
  }

  function card(r) {
    const level = r.score >= 0.999 ? '제목 일치' : r.score >= 0.5 ? '일부 일치' : '';
    const scenes = r.scenes.size ? `비슷한 장면 ${r.scenes.size}/${frames.length || 3}` : '';
    return el('a', { className: 'finder-item' + (likely(r) ? ' match' : ''), href: r.url, target: '_blank', rel: 'noopener noreferrer' },
      r.thumb ? el('img', { src: r.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : el('div', { className: 'finder-noimg', textContent: hostOf(r.url).slice(0, 1).toUpperCase() }),
      el('div', { className: 'finder-body' },
        el('b', { textContent: r.title || hostOf(r.url) }),
        el('span', { className: 'finder-meta', textContent: [hostOf(r.url), r.duration, level, scenes].filter(Boolean).join(' · ') }),
        r.snippet ? el('span', { className: 'finder-snippet', textContent: r.snippet }) : null));
  }

  // 확장 패널 [찾기] 로 열린 경우: 주소 #find=표&q=이름 (index.html 이 첫 화면을 [검색] 으로 둠). 새로고침해도 다시 돌지 않게 주소에서 지움
  let opened = (() => {
    const ticket = /[#&]find=([0-9a-f-]{36})(?:&|$)/.exec(location.hash)?.[1];
    if (!ticket) return null;
    let name = ''; try { name = decodeURIComponent(/[#&]q=([^&]*)/.exec(location.hash)?.[1] || ''); } catch {}
    return { ticket, name: name.slice(0, 200) };
  })();

  function view() {
    if (opened) {
      const { ticket, name } = opened; opened = null;
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => searchLink('', name, { ticket }));
    }
    if (extOk === null) ask({ type: 'ping' }).then(reply => { extOk = Boolean(reply?.ok); if (currentView === 'finder') renderGrid(); });
    const busy = state === 'busy';
    const nameInput = el('input', { type: 'search', className: 'finder-input', value: query, placeholder: '영상 이름 · 출연자 (예: Gattouz0 2026-02-08)',
      onkeydown: e => { if (e.key === 'Enter' && !e.isComposing && !busy) search(nameInput.value); } });
    const linkInput = el('input', { type: 'url', className: 'finder-input', value: link, placeholder: '영상 링크 (영상 페이지 또는 영상 주소)',
      onkeydown: e => { if (e.key === 'Enter' && !e.isComposing && !busy) searchLink(linkInput.value, nameInput.value); } });
    const note = busy ? status
      : problem === 'noext' || extOk === false ? '이 브라우저에 "개인 영상 저장" 확장이 없거나 꺼져 있어요. 확장을 켠 크롬에서 열어 주세요.'
      : problem === 'captcha' ? 'Yandex 가 로봇 확인을 요구해요. 아래 버튼으로 Yandex 를 열어 확인을 마친 뒤 다시 검색하세요.'
      : problem ? `검색 실패: ${problem}`
      : state === 'done' ? `결과 ${found.size}개 · 제목이 많이 겹치는 순 (비슷한 장면은 닮은 사람·배경일 수도 있어요)` : '이름으로 찾거나, 영상 링크를 넣으면 장면 3장으로도 찾아요.';
    const panel = el('div', { className: 'm-sec finder' },
      el('b', { textContent: '다른 곳에서 찾기 (Yandex)' }),
      el('div', { className: 'row' }, nameInput,
        el('button', { className: 'primary', textContent: '검색', disabled: busy, onclick: () => search(nameInput.value) })),
      el('div', { className: 'row' }, linkInput,
        el('button', { className: 'primary', textContent: '링크로 찾기', disabled: busy, onclick: () => searchLink(linkInput.value, nameInput.value) })),
      el('p', { className: 'hint' + (problem || extOk === false ? ' error' : ''), textContent: note }),
      problem === 'captcha' ? el('a', { className: 'button', href: 'https://yandex.com/images/', target: '_blank', rel: 'noopener', textContent: 'Yandex 열기' }) : null,
      frames.length ? el('div', { className: 'finder-frames' }, ...frames.map(f => el('figure', {},
        el('img', { src: f.src, alt: '' }), el('figcaption', { textContent: fmt(f.at) }))),
        el('button', { textContent: '장면으로 찾기', disabled: busy, onclick: scenesOnly })) : null);
    const list = results(), top = list.filter(likely), rest = list.filter(r => !likely(r));
    return el('div', { id: 'finderView' }, panel,
      top.length ? el('h2', { className: 'section-title', textContent: `같은 영상일 가능성 높음 (${top.length})` }) : null,
      top.length ? el('div', { className: 'finder-list' }, ...top.map(card)) : null,
      rest.length ? el('h2', { className: 'section-title', textContent: `그 밖의 결과 (${rest.length})` }) : null,
      rest.length ? el('div', { className: 'finder-list' }, ...rest.map(card)) : null);
  }

  return { view, search, searchLink, parseWeb, parseVideo, parseImage, overlap };
})();
