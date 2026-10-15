// 필터로 보이는 영상만 사용하고, 시리즈가 처음 나타나는 자리에서 지정 순서대로 붙인다.
(function (root) {
  'use strict';
  function arrange(list, seriesMap = {}) {
    const byId = new Map(list.map(f => [f.id, f]));
    const owner = new Map(), members = new Map();
    for (const [key, series] of Object.entries(seriesMap)) {
      if (!Array.isArray(series && series.videoIds)) continue;
      const ids = [];
      for (const id of series.videoIds) {
        if (!byId.has(id) || owner.has(id)) continue;
        owner.set(id, key); ids.push(id);
      }
      members.set(key, ids);
    }
    const result = [], seen = new Set();
    for (const f of list) {
      if (seen.has(f.id)) continue;
      const key = owner.get(f.id);
      for (const id of key === undefined ? [f.id] : members.get(key)) {
        if (!seen.has(id)) { seen.add(id); result.push(byId.get(id)); }
      }
    }
    return result;
  }
  const api = { arrange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GallerySeries = api;
})(globalThis);
