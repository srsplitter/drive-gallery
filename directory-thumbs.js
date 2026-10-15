// Directory covers reference existing video thumbnails; no video files are opened.
const DirectoryThumbs = (() => {
  let expanded = null;
  let observed = null;
  let observedWidth = -1, frame = 0;
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const width = entries[0].contentRect.width;
    if (width === observedWidth) return;
    observedWidth = width;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (observed && observed.isConnected) layout(observed);
    });
  });
  const editing = () => document.body.classList.contains('editing');
  const eligible = f => !isHidden(f) || (showHidden && editing());
  function ordered(videoList) {
    const list = GalleryOrder.sortVideos(videoList.filter(eligible), { ...gallery, loved: {} }, items);
    return GallerySeries.arrange(ManualOrderUI.sorted(list, 'regular'), gallery.series);
  }
  function toggle(key) {
    if (!editing()) return;
    expanded = expanded === key ? null : key;
  }
  function layout(container) {
    if (observer && observed !== container) {
      observer.disconnect(); observed = container; observedWidth = -1; observer.observe(container);
    }
    const panel = container.querySelector('.directory-cover-row');
    const choices = panel ? panel.querySelector('.cover-candidates') : container.querySelector('.directory-item > .cover-candidates');
    if (!choices) return;
    const row = panel || el('div', { className: 'directory-cover-row' });
    const key = panel ? panel.dataset.coverKey : choices.parentElement.dataset.coverKey;
    row.dataset.coverKey = key;
    // Remove the expanded row before measuring the original tile rows after a resize.
    row.remove(); choices.remove();
    const tiles = [...container.children].filter(n => n.classList.contains('directory-item'));
    const active = tiles.find(n => n.dataset.coverKey === key);
    if (!active) return;
    const rect = active.getBoundingClientRect();
    const last = tiles.filter(n => Math.abs(n.getBoundingClientRect().top - rect.top) < 1).pop();
    row.append(choices); last.after(row);
    const bounds = row.getBoundingClientRect();
    const width = Math.min(720, bounds.width, choices.children.length * 88 + Math.max(0, choices.children.length - 1) * 8);
    choices.style.width = width + 'px';
    choices.style.marginLeft = Math.max(0, Math.min(bounds.width - width, rect.left + rect.width / 2 - bounds.left - width / 2)) + 'px';
  }
  window.addEventListener('resize', () => {
    const container = document.querySelector('.tag-directory');
    if (container) layout(container);
  });
  function thumbnail(f) {
    const wrap = el('span', { className: 'cover-thumb' });
    const icon = () => el('span', { className: 'icon', textContent: '🎞️' });
    const custom = gallery.videos[f.id];
    const src = custom && custom.thumb || (!custom || !custom.file) && f.thumbnailLink;
    if (src || (custom && custom.file)) {
      const img = el('img', { alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
      img.onerror = () => img.replaceWith(icon());
      img.onload = () => img.classList.add('ok');
      if (src) img.src = src; else lazyThumb(img, custom.file);
      if (img.complete && img.naturalWidth) img.classList.add('ok');
      wrap.append(img);
    } else wrap.append(icon());
    return wrap;
  }
  function item(key, button, videoList) {
    const candidates = ordered(videoList), coverId = (gallery.covers || {})[key];
    const cover = candidates.find(f => f.id === coverId) || candidates[0];
    const wrap = el('div', { className: 'directory-item' });
    wrap.dataset.coverKey = key;
    if (key.startsWith('tag:')) {
      const name = key.slice(4);
      for (const node of [...button.childNodes]) {
        if (node.nodeType === 3 && node.textContent === name) node.replaceWith(el('span', { className: 'directory-name', textContent: name, title: name }));
      }
      button.title = name;
    }
    if (cover) button.prepend(thumbnail(cover));
    wrap.append(button);
    if (editing() && expanded === key) {
      const choices = el('div', { className: 'cover-candidates' });
      for (const f of candidates) {
        const candidate = el('button', { className: 'cover-candidate' + (f.id === coverId ? ' selected' : ''),
          title: f.name, ariaLabel: '대표 이미지 선택: ' + f.name,
          onclick: e => {
            e.preventDefault(); e.stopPropagation();
            if (!editing() || !eligible(f)) return;
            gallery.covers = gallery.covers || {};
            gallery.covers[key] = f.id;
            pendingSaves.set('p:' + key, f.id);
            renderGrid(); flushSaves();
          } }, thumbnail(f));
        candidate.dataset.videoId = f.id;
        candidate.setAttribute('aria-pressed', String(f.id === coverId));
        choices.append(candidate);
      }
      wrap.append(choices);
    }
    return wrap;
  }
  function tag(t, pill) {
    return item('tag:' + t, pill, items.filter(f => tagsOf(f).includes(t)));
  }
  return { item, tag, toggle, layout };
})();
