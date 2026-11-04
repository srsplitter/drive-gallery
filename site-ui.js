// 헤더 [사이트] 탭: "사이트" 종류 태그(파란 테두리)를 시리즈 목록처럼 한 줄씩 보여 줌. [태그] 목록의 "사이트(으)로 이동"으로 옮겨 옴.
// 줄 앞에 대표 썸네일(시리즈처럼, 표지 키 'tag:이름' — [태그] 목록과 같은 표지).
// 수정 OFF: 이름(영상 수) 아래에 그 사이트로 가는 칸(누르면 새 탭). 태그에서 막 넘어온 사이트는 주소가 없어 빈칸.
// 수정 ON: 주소 칸은 숨기고 이름이 그 주소 링크(새 탭). 이름 말고 칸을 누르면 펼쳐져 대표 썸네일 고르기 + 주소 고치기
// (Enter 저장, Esc·다른 곳 누르면 취소).
// 링크 말고 줄의 다른 곳을 누르면 그 줄 바로 아래에 그 태그가 붙은 영상(지금 정렬 그대로)을 보여 주고, 다시 누르면 닫음.
// 주소는 gallery.json 의 siteUrls(태그 → 주소, 변경 키 'w:'). index.html 전역(el, gallery, tagKind, items, tagsOf, query,
// videoCard, renderGrid, pendingSaves, flushSaves, shown)을 씀.
const SiteUI = (() => {
  let openTag = null;
  const editing = () => document.body.classList.contains('editing');
  const safeUrl = value => {
    const text = String(value || '').trim();
    if (!text) return '';
    try { const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  };
  const shortUrl = url => { try { const u = new URL(url); return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch { return url; } };

  function setUrl(t, url) {
    if (!editing()) return;
    if (url) gallery.siteUrls[t] = url; else delete gallery.siteUrls[t];
    pendingSaves.set('w:' + t, url || null);
    renderGrid();
    flushSaves();
  }
  // 주소 칸 → 입력칸 (그 자리에서). 주소처럼 보이지 않으면 저장하지 않고 알려 줌
  function editUrl(slot, t) {
    const input = el('input', { className: 'm-in site-url-in', value: gallery.siteUrls[t] || '', placeholder: '사이트 주소 (예: https://example.com)', spellcheck: false, type: 'url' });
    let done = false;
    const finish = save => {
      if (done) return;
      if (save) {
        const url = safeUrl(input.value);
        if (url === null) { input.setCustomValidity('http 또는 https 주소를 넣어 주세요.'); input.reportValidity(); return; }
        done = true;
        return setUrl(t, url);
      }
      done = true;
      renderGrid();
    };
    input.onclick = e => e.stopPropagation();
    input.oninput = () => input.setCustomValidity('');
    input.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    input.onblur = () => { if (!done) { done = true; renderGrid(); } };
    slot.replaceWith(input);
    input.focus();
    input.select();
  }
  function urlSlot(t) {
    const url = gallery.siteUrls[t] || '';
    if (editing()) {
      const slot = el('button', { type: 'button', className: 'site-link' + (url ? '' : ' empty'), textContent: url ? shortUrl(url) : '', title: '사이트 주소 고치기' });
      slot.setAttribute('aria-label', `${t} 사이트 주소 ${url ? '고치기' : '넣기'}`);
      slot.onclick = e => { e.stopPropagation(); editUrl(slot, t); };
      return slot;
    }
    if (!url) return el('span', { className: 'site-link empty' });
    const link = el('a', { className: 'site-link', href: url, target: '_blank', rel: 'noopener noreferrer', textContent: shortUrl(url) + ' ↗', title: url });
    link.onclick = e => e.stopPropagation();
    return link;
  }

  function view(list, counts) {
    const hit = t => !query || t.toLowerCase().includes(query)
      || items.some(f => tagsOf(f).includes(t) && (f.name.toLowerCase().includes(query) || tagsOf(f).some(x => x.toLowerCase().includes(query))));
    const tags = [...counts.keys()].filter(t => tagKind(t) === 'site' && hit(t)).sort(window.GalleryOrder.compareText);
    const on = editing();
    // 수정 ON 에서는 펼친 칸(대표 썸네일 고르기)과 영상 목록이 같은 줄
    if (on) { const cur = DirectoryThumbs.current(); openTag = cur && cur.startsWith('tag:') ? cur.slice(4) : null; }
    if (openTag && !tags.includes(openTag)) openTag = null;
    const rows = el('div', { id: 'siteList' });
    for (const t of tags) {
      const url = gallery.siteUrls[t] || '';
      const name = on && url ? el('a', { className: 'site-name', href: url, target: '_blank', rel: 'noopener noreferrer', textContent: t, title: url })
        : el('b', { textContent: t });
      if (name.tagName === 'A') name.onclick = e => e.stopPropagation();
      const row = el('div', { className: 'site-row' + (openTag === t ? ' active' : ''), role: 'button', tabIndex: 0 },
        el('div', { className: 'site-body' },
          el('div', { className: 'site-main' }, name, el('span', { className: 'cnt', textContent: `(${counts.get(t) || 0})` })),
          ...(on ? [] : [urlSlot(t)])));
      row.dataset.tag = t;
      const toggle = () => {
        if (editing()) DirectoryThumbs.toggle('tag:' + t);
        else openTag = openTag === t ? null : t;
        renderGrid();
      };
      row.onclick = toggle;
      row.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } };
      const item = DirectoryThumbs.item('tag:' + t, row, items.filter(f => tagsOf(f).includes(t)), { plain: true });
      if (on && openTag === t) item.append(el('div', { className: 'site-url-edit' }, el('span', { className: 'hint', textContent: '주소' }), urlSlot(t)));
      rows.append(item);
      if (openTag === t) {
        const videos = list.filter(f => tagsOf(f).includes(t));
        rows.append(el('section', { className: 'site-videos' },
          el('h2', { className: 'section-title', textContent: `${t} (${videos.length})` }),
          videos.length ? el('div', { className: 'cat-grid' }, ...videos.map(f => videoCard(f, counts))) : el('p', { className: 'hint', textContent: '지금 조건에 맞는 영상이 없어요.' })));
      }
    }
    const box = el('div', { className: 'site-library' }, rows);
    if (!tags.length) box.append(el('p', { className: 'hint', textContent: query ? '일치하는 사이트가 없어요.'
      : '사이트 태그가 없어요. 수정 ON 에서 [태그] 목록 맨 아래 "사이트(으)로 이동"에 태그를 적어 옮겨 주세요.' }));
    return el('div', { id: 'siteView' }, box);
  }

  return { view, safeUrl };
})();
