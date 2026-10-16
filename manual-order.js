// Persistent numeric coordinates. Deleted IDs remain as tombstones until restore.
(function (root) {
  'use strict';
  const STEP = 1024;
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  function rebalance(ranks) {
    return Object.fromEntries(Object.keys(ranks).sort((a, b) => ranks[a] - ranks[b])
      .map((id, i) => [id, (i + 1) * STEP]));
  }
  function ensure(autoIds, ranks = {}) {
    const out = Object.fromEntries(Object.entries(ranks).filter(([, n]) => valid(n)));
    const ids = [...new Set(autoIds)];
    for (let i = 0; i < ids.length;) {
      if (valid(out[ids[i]])) { i++; continue; }
      let end = i + 1;
      while (end < ids.length && !valid(out[ids[end]])) end++;
      const prev = i ? out[ids[i - 1]] : undefined, next = out[ids[end]];
      const values = Object.values(out);
      let lo, hi;
      if (valid(next)) {
        hi = next;
        // Crossed manual anchors: use next automatic neighbor and its numeric predecessor.
        lo = valid(prev) && prev < hi ? prev : Math.max(...values.filter(n => n < hi), hi - STEP);
      } else {
        lo = valid(prev) ? Math.max(prev, ...values) : Math.max(0, ...values);
        hi = lo + STEP * (end - i + 1);
      }
      // Tombstones and other manual slots must not collide with newly assigned slots.
      const occupied = values.filter(n => n > lo && n < hi).sort((a, b) => a - b);
      if (occupied.length) lo = occupied[occupied.length - 1];
      const nums = ids.slice(i, end).map((_, j) => lo + (hi - lo) * (j + 1) / (end - i + 1));
      if (nums.some((n, j) => !valid(n) || n <= (j ? nums[j - 1] : lo) || n >= hi)) {
        return ensure(ids, rebalance(out));
      }
      nums.forEach((n, j) => { out[ids[i + j]] = n; });
      i = end;
    }
    return out;
  }
  function sort(list, ranks = {}) {
    return [...list].sort((a, b) => ranks[a.id] - ranks[b.id]);
  }
  // beforeId null appends. Rebalance only when numeric precision is exhausted.
  function move(autoIds, ranks, movingIds, beforeId = null) {
    let out = ensure(autoIds, ranks);
    const moving = [...new Set(movingIds)].filter(id => valid(out[id]));
    if (!moving.length || moving.includes(beforeId)) return out;
    const remaining = Object.keys(out).filter(id => !moving.includes(id)).sort((a, b) => out[a] - out[b]);
    let at = beforeId === null ? remaining.length : remaining.indexOf(beforeId);
    if (at < 0) return out;
    function assign() {
      const lo = at ? out[remaining[at - 1]] : (at < remaining.length ? out[remaining[at]] - STEP : 0);
      const hi = at < remaining.length ? out[remaining[at]] : lo + STEP * (moving.length + 1);
      const nums = moving.map((_, i) => lo + (hi - lo) * (i + 1) / (moving.length + 1));
      if (nums.some((n, i) => !valid(n) || n <= (i ? nums[i - 1] : lo) || n >= hi)) return false;
      moving.forEach((id, i) => { out[id] = nums[i]; });
      return true;
    }
    if (!assign()) {
      out = rebalance(out);
      assign();
    }
    return out;
  }
  const api = { ensure, sort, move };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryManualOrder = api;
})(globalThis);

// Browser glue stays separate from pure numeric ordering API above.
const ManualOrderUI = (() => {
  let dragging = null, suppressClickUntil = 0, flushQueued = false;
  const enabled = () => document.body.classList.contains('editing') && (!currentView || currentView === 'title') && !SeriesUI.mode && !randomRank;
  const auto = namespace => GalleryOrder.sortVideos(namespace === 'favorites' ? items.filter(isLoved) : items,
    { ...gallery, loved: {} }, items);
  const ranks = namespace => (gallery.order || {})[namespace] || {};
  function sorted(list, namespace) {
    if (!Object.keys(ranks(namespace)).length) {
      if (namespace !== 'favorites' || randomRank) return list;
      const visible = new Set(list.map(f => f.id));
      return auto(namespace).filter(f => visible.has(f.id));
    }
    const previous = ranks(namespace);
    const ensured = GalleryManualOrder.ensure(auto(namespace).map(f => f.id), previous);
    if (Object.keys(ensured).some(id => ensured[id] !== previous[id])) {
      saveOrder(namespace, ensured);
      if (!flushQueued) {
        flushQueued = true;
        queueMicrotask(() => { flushQueued = false; flushSaves(); });
      }
    }
    return GalleryManualOrder.sort(list, ensured);
  }
  function saveOrder(namespace, value) {
    gallery.order = gallery.order || {};
    gallery.order[namespace] = value;
    pendingSaves.set('o:' + namespace, value);
  }
  function restore() {
    if (!document.body.classList.contains('editing') || currentView || SeriesUI.mode) return;
    for (const key of Object.keys(gallery.order || {})) pendingSaves.set('o:' + key, null);
    gallery.order = {}; randomRank = null;
    renderGrid(); flushSaves();
  }
  function autoSort() {
    if (!token || currentView || SeriesUI.mode) return;
    if (gallery.order && Object.hasOwn(gallery.order, 'regular')) {
      delete gallery.order.regular;
      pendingSaves.set('o:regular', null);
    }
    randomRank = null;
    renderGrid(); flushSaves();
  }
  const owner = id => Object.keys(gallery.series || {}).find(key => (gallery.series[key].videoIds || []).includes(id));
  function clearIndicators() {
    document.querySelectorAll('.order-before,.order-after,.order-dragging').forEach(card =>
      card.classList.remove('order-before', 'order-after', 'order-dragging'));
  }
  function bind() {
    for (const [selector, namespace] of [['#regularVideos', 'regular'], ['#favoriteVideos', 'favorites'], ['#titleEditor .cat-grid', 'regular']]) {
      const section = document.querySelector(selector);
      if (!section) continue;
      const cards = [...section.querySelectorAll('.card[data-id]')];
      const ids = cards.map(card => card.dataset.id);
      for (const card of cards) {
        card.draggable = enabled();
        // Prevent native image dragging; normal click behavior remains on card.
        card.querySelectorAll('img').forEach(img => { img.draggable = false; });
        card.ondragstart = e => {
          if (!enabled() || e.target.closest('input,textarea')) { e.preventDefault(); return; }
          dragging = { id: card.dataset.id, namespace };
          e.dataTransfer.setData('text/plain', dragging.id);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('order-dragging');
        };
        const before = e => e.clientX < card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2;
        card.ondragover = e => {
          if (!enabled() || !dragging || dragging.namespace !== namespace) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          clearIndicators(); card.classList.add(before(e) ? 'order-before' : 'order-after');
        };
        card.ondragleave = () => card.classList.remove('order-before', 'order-after');
        card.ondrop = e => {
          if (!enabled() || !dragging || dragging.namespace !== namespace) return;
          e.preventDefault(); e.stopPropagation();
          const source = dragging.id, index = ids.indexOf(card.dataset.id) + (before(e) ? 0 : 1);
          clearIndicators();
          if (source === card.dataset.id) return;
          const sourceSeries = namespace === 'regular' && owner(source);
          const leftSeries = index > 0 && owner(ids[index - 1]);
          const rightSeries = index < ids.length && owner(ids[index]);
          const join = namespace === 'regular' && leftSeries && leftSeries === rightSeries ? leftSeries : null;
          const within = sourceSeries && owner(card.dataset.id) === sourceSeries;
          const moving = sourceSeries && !within ? [...gallery.series[sourceSeries].videoIds] : [source];
          let beforeId = ids.slice(index).find(id => !moving.includes(id)) || null;
          // A boundary outside a series always targets its entire block.
          if (!join && !within && namespace === 'regular' && beforeId) {
            const targetSeries = owner(beforeId);
            if (targetSeries) beforeId = ids.find(id => owner(id) === targetSeries && !moving.includes(id)) || beforeId;
          }
          const targetSeries = within ? sourceSeries : join;
          if (targetSeries) {
            for (const [key, series] of Object.entries(gallery.series)) {
              if (key === targetSeries || !series.videoIds.some(id => moving.includes(id))) continue;
              const value = { ...series, videoIds: series.videoIds.filter(id => !moving.includes(id)) };
              gallery.series[key] = value; pendingSaves.set('s:' + key, value);
            }
            const series = gallery.series[targetSeries];
            const remaining = series.videoIds.filter(id => !moving.includes(id));
            const anchor = ids.slice(index).find(id => remaining.includes(id));
            const at = anchor === undefined ? remaining.length : remaining.indexOf(anchor);
            remaining.splice(at, 0, ...moving);
            const value = { ...series, videoIds: remaining };
            gallery.series[targetSeries] = value; pendingSaves.set('s:' + targetSeries, value);
          }
          saveOrder(namespace, GalleryManualOrder.move(auto(namespace).map(f => f.id), ranks(namespace), moving, beforeId));
          suppressClickUntil = Date.now() + 400; dragging = null;
          renderGrid(); flushSaves();
        };
        card.ondragend = () => { suppressClickUntil = Date.now() + 400; dragging = null; clearIndicators(); };
      }
    }
  }
  if (typeof document !== 'undefined') document.addEventListener('click', e => {
    if (Date.now() < suppressClickUntil && e.target.closest('.card')) {
      e.preventDefault(); e.stopImmediatePropagation(); suppressClickUntil = 0;
    }
  }, true);
  return { sorted, bind, restore, autoSort };
})();
