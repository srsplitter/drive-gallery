// Directory covers reference existing video thumbnails; no video files are opened.
const DirectoryThumbs = (() => {
  const expanded = new Set();
  const editing = () => document.body.classList.contains('editing');
  const eligible = f => !isHidden(f) || (showHidden && editing());
  function ordered(videoList) {
    const list = GalleryOrder.sortVideos(videoList.filter(eligible), { ...gallery, loved: {} }, items);
    return GallerySeries.arrange(ManualOrderUI.sorted(list, 'regular'), gallery.series);
  }
  function toggle(key) {
    if (!editing()) return;
    if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
  }
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
    if (cover) button.prepend(thumbnail(cover));
    wrap.append(button);
    if (editing() && expanded.has(key)) {
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
  return { item, tag, toggle };
})();
