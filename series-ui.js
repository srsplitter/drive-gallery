// 시리즈 지정·재생목록 편집. 영상 파일이나 썸네일은 변경하지 않는다.
const SeriesUI = (() => {
  let selection = null, selectedId = null, orderDraft = null;
  const editing = () => document.body.classList.contains('editing');
  const saved = () => gallery.series || {};
  function owner(videoId) {
    return Object.keys(saved()).find(id => (saved()[id].videoIds || []).includes(videoId));
  }
  function members(id) { return [...new Set(saved()[id].videoIds || [])].filter(videoId => owner(videoId) === id); }
  function cancel() { selection = null; orderDraft = null; }
  function leave() { cancel(); selectedId = null; }
  function store(id, value) {
    if (!editing()) return;
    if (value) gallery.series[id] = value; else delete gallery.series[id];
    pendingSaves.set('s:' + id, value);
    renderGrid(); flushSaves();
  }
  function start() {
    if (!editing()) return;
    cancel(); selection = { id: null, ids: [] };
    if (currentView) {
      clearTimeout(searchTimer); currentView = ''; query = ''; searchOpen = false;
    }
    renderGrid();
  }
  function activate(id) {
    if (!editing() || !selection || !saved()[id]) return;
    selection = { id, ids: members(id) };
    renderGrid();
  }
  function choose(f) {
    if (!selection || !editing()) return;
    const id = owner(f.id);
    if (id && selection.id !== id) return activate(id);
    const at = selection.ids.indexOf(f.id);
    if (at < 0) selection.ids.push(f.id); else selection.ids.splice(at, 1);
    renderGrid();
  }
  function autoName(f) {
    const tags = sortedTags(f), genres = tags.filter(t => tagKind(t) === 'genre');
    const lead = genres.length ? genres : tags.filter(t => tagKind(t) === 'character');
    const base = [...lead, ...tags.filter(t => tagKind(t) === 'category')].join(' ') || '시리즈';
    const names = new Set(Object.values(saved()).map(s => s.name));
    let n = 1; while (names.has(base + ' ' + n)) n++;
    return base + ' ' + n;
  }
  function saveSelection() {
    if (!editing() || !selection) return;
    if (!selection.ids.length) return setStatus('시리즈로 묶을 영상을 선택해 주세요.');
    const draft = selection, previous = draft.id && saved()[draft.id];
    const id = draft.id || crypto.randomUUID();
    const f = items.find(f => f.id === draft.ids[0]);
    if (!previous && !f) return setStatus('선택한 영상을 찾지 못했어요.');
    // 다른 시리즈에 속한 영상은 중복으로 가져오지 않는다.
    const ids = [...new Set(draft.ids)].filter(videoId => !owner(videoId) || owner(videoId) === draft.id);
    if (!ids.length) return;
    const value = { ...(previous || {}), name: previous ? previous.name : autoName(f),
      createdAt: previous ? previous.createdAt : new Date().toISOString(), videoIds: ids };
    cancel(); store(id, value);
  }
  function toolbar() {
    const wrap = el('div', { className: 'series-actions edit-only' });
    wrap.append(el('button', { className: 'chip', textContent: '↻', title: '검색 조건 초기화', ariaLabel: '검색 조건 초기화', onclick: () => $('#menuReset').click() }));
    if (!selection) { wrap.append(el('button', { className: 'chip', textContent: '시리즈 지정', onclick: start })); return wrap; }
    wrap.append(el('span', { className: 'hint', textContent: (selection.id ? saved()[selection.id].name : '새 시리즈') + ' · ' + selection.ids.length + '개' }),
      el('button', { className: 'primary', textContent: '저장', onclick: saveSelection }),
      el('button', { textContent: '취소', onclick: () => { cancel(); renderGrid(); } }));
    if (selection.id || selection.ids.length) wrap.append(el('button', { textContent: '새 시리즈', onclick: start }));
    return wrap;
  }
  function decorate(card, f) {
    if (selection) {
      const at = selection.ids.indexOf(f.id);
      if (at >= 0) {
        card.classList.add('series-picked');
        card.querySelector('.thumb').append(el('span', { className: 'series-order-badge', textContent: String(at + 1) }));
      }
    } else {
      const id = owner(f.id), s = id && saved()[id];
      if (s) card.append(el('div', { className: 'series-card-label', textContent: s.name + ' · ' + (members(id).indexOf(f.id) + 1) }));
    }
  }
  function grid(list, counts) {
    if (!selection) return el('div', { className: 'cat-grid' }, ...list.map(f => videoCard(f, counts)));
    const byId = new Map(list.map(f => [f.id, f])), done = new Set(), blocks = [];
    for (const f of list) {
      const id = owner(f.id);
      if (!id) { blocks.push(videoCard(f, counts)); continue; }
      if (done.has(id)) continue;
      done.add(id);
      const s = saved()[id];
      const videos = members(id).filter(key => byId.has(key)).map(key => byId.get(key));
      const group = el('section', { className: 'series-group' + (selection.id === id ? ' active' : '') },
        el('button', { className: 'series-group-title', textContent: s.name, onclick: () => activate(id) }),
        el('div', { className: 'cat-grid' }, ...videos.map(f => videoCard(f, counts))));
      group.dataset.seriesId = id;
      group.onclick = e => { if (!e.target.closest('.card,button')) activate(id); };
      blocks.push(group);
    }
    return el('div', { className: 'series-selection' },
      el('p', { className: 'hint', textContent: '순서대로 썸네일을 누른 뒤 저장하세요. 노란 묶음을 고르면 기존 시리즈에 추가합니다.' }),
      el('div', { className: 'cat-grid' }, ...blocks));
  }
  function rename(id, button) {
    if (!editing()) return;
    const input = el('input', { className: 'm-in series-name-input', value: saved()[id].name, 'ariaLabel': '시리즈 이름' });
    button.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      const name = input.value.trim();
      if (save && editing() && saved()[id] && name) store(id, { ...saved()[id], name }); else renderGrid();
    };
    input.onkeydown = e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); };
    input.onblur = () => finish(true);
  }
  function library() {
    const list = el('div', { className: 'series-library' }), rows = el('div', { id: 'seriesList' });
    const entries = Object.entries(saved()).filter(([, s]) => !query || s.name.toLowerCase().includes(query));
    for (const [id, s] of entries) {
      const title = el('button', { className: 'series-open', textContent: s.name + ' · ' + members(id).length + '개',
        onclick: () => { selectedId = selectedId === id ? null : id; orderDraft = null; renderGrid(); } });
      const pen = el('button', { className: 'edit-only', textContent: '수정', title: '시리즈 이름 수정', onclick: () => rename(id, title) });
      pen.setAttribute('aria-label', '시리즈 이름 수정: ' + s.name);
      const order = el('button', { className: 'edit-only', textContent: '순서 수정', onclick: () => {
        if (!editing()) return; selectedId = id; orderDraft = { id, ids: members(id) }; renderGrid();
      } });
      order.setAttribute('aria-label', '시리즈 순서 수정: ' + s.name);
      const bin = el('button', { className: 'edit-only danger', textContent: '휴지통', title: '시리즈 묶음만 해제 (영상은 유지)' });
      let armed = false, timer;
      bin.onclick = () => {
        if (!editing()) return;
        if (!armed) { armed = true; bin.textContent = '묶음 해제'; timer = setTimeout(() => { armed = false; bin.textContent = '휴지통'; }, 3000); return; }
        clearTimeout(timer); if (selectedId === id) selectedId = null; orderDraft = null; store(id, null);
      };
      const row = el('div', { className: 'series-row' + (selectedId === id ? ' active' : '') }, title, pen, order, bin);
      row.dataset.seriesId = id; rows.append(row);
    }
    list.append(rows);
    if (!entries.length) list.append(el('p', { className: 'hint', textContent: query ? '일치하는 시리즈가 없어요.' : '저장한 시리즈가 없어요. 수정 ON에서 시리즈 지정으로 만들어 주세요.' }));
    if (selectedId && entries.some(([id]) => id === selectedId)) {
      const s = saved()[selectedId], allowed = new Map(shown.map(f => [f.id, f]));
      if (orderDraft && editing()) list.append(orderEditor(allowed));
      else {
        shown = members(selectedId).filter(id => allowed.has(id)).map(id => allowed.get(id));
        list.append(el('h2', { className: 'series-playlist-title', textContent: s.name }), el('div', { className: 'cat-grid' }, ...shown.map(f => videoCard(f))));
      }
    }
    return list;
  }
  function orderEditor(allowed) {
    const draft = orderDraft, cards = el('div', { className: 'cat-grid' });
    let dragging = null;
    for (const id of draft.ids) {
      if (!allowed.has(id)) continue;
      const card = videoCard(allowed.get(id));
      card.onclick = e => e.preventDefault();
      const item = el('div', { className: 'series-reorder-item', draggable: true }, card);
      item.dataset.videoId = id;
      item.ondragstart = e => { dragging = id; e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; };
      item.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
      item.ondrop = e => {
        e.preventDefault();
        if (!editing() || orderDraft !== draft) return;
        const from = draft.ids.indexOf(dragging || e.dataTransfer.getData('text/plain')), to = draft.ids.indexOf(id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = draft.ids.splice(from, 1); draft.ids.splice(to, 0, moved); renderGrid();
      };
      cards.append(item);
    }
    return el('section', { id: 'seriesEditor' },
      el('h2', { className: 'series-playlist-title', textContent: saved()[draft.id].name + ' · 드래그해서 순서 수정' }), cards,
      el('div', { className: 'row' },
        el('button', { className: 'primary', textContent: '순서 저장', onclick: () => {
          if (!editing() || !saved()[draft.id]) return; orderDraft = null; store(draft.id, { ...saved()[draft.id], videoIds: [...draft.ids] });
        } }),
        el('button', { textContent: '취소', onclick: () => { orderDraft = null; renderGrid(); } })));
  }
  function viewerNav(f) {
    const index = shown.indexOf(f);
    for (const [selector, step] of [['#vPrev', -1], ['#vNext', 1]]) {
      const button = $(selector), next = index >= 0 ? shown[index + step] : null;
      button.disabled = !next;
      button.onclick = () => {
        const at = shown.indexOf(viewerFile), target = at >= 0 ? shown[at + step] : null;
        if (target) openViewer(target);
      };
    }
    const id = owner(f.id), s = id && saved()[id];
    $('#vBody').querySelector('.series-playing')?.remove();
    if (s) { const ids = members(id); $('#vBody').prepend(el('div', { className: 'series-playing', textContent: s.name + ' · ' + (ids.indexOf(f.id) + 1) + '/' + ids.length })); }
  }
  return { get mode() { return !!selection; }, cancel, leave, start, toolbar, decorate, choose, grid, library, viewerNav };
})();
