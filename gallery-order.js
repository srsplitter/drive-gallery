// 화면 필터와 무관한 전체 태그 사용량으로 순서를 정한다.
(function (root) {
  'use strict';
  const collator = new Intl.Collator('ko', { numeric: true });
  const group = value => /^\p{N}/u.test(value) ? 2 : /^[\p{L}\p{M}]/u.test(value) ? 1 : 0;
  function compareText(a, b) {
    a = String(a || '').trim(); b = String(b || '').trim();
    return group(a) - group(b) || collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
  }
  function countTags(list, gallery) {
    const counts = new Map();
    for (const f of list) for (const t of new Set((gallery.tags || {})[f.id] || [])) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
  }
  function sortVideos(list, gallery, universe = list) {
    const tags = f => [...new Set((gallery.tags || {})[f.id] || [])];
    const kinds = gallery.tagKinds || {}, counts = countTags(universe, gallery);
    const ranked = (a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || compareText(a, b);
    const primaryGenre = f => tags(f).filter(t => kinds[t] === 'genre').sort(ranked)[0] || '';
    const characterCounts = new Map();
    for (const f of universe) {
      const genre = primaryGenre(f);
      if (!characterCounts.has(genre)) characterCounts.set(genre, new Map());
      const n = characterCounts.get(genre);
      for (const t of tags(f).filter(t => kinds[t] === 'character')) n.set(t, (n.get(t) || 0) + 1);
    }
    const primaryCharacter = (ts, genre) => {
      const n = characterCounts.get(genre) || new Map();
      return ts.filter(t => kinds[t] === 'character').sort((a, b) => (n.get(b) || 0) - (n.get(a) || 0) || compareText(a, b))[0] || '';
    };
    const categoryCounts = new Map();
    const categoryKey = (genre, char) => JSON.stringify([genre, char]);
    for (const f of universe) {
      const ts = tags(f), genre = primaryGenre(f), key = categoryKey(genre, primaryCharacter(ts, genre));
      if (!categoryCounts.has(key)) categoryCounts.set(key, new Map());
      const n = categoryCounts.get(key);
      for (const t of ts.filter(t => kinds[t] === 'category')) n.set(t, (n.get(t) || 0) + 1);
    }
    const title = (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id);
    const data = list.map(f => {
      const ts = tags(f), genre = primaryGenre(f), n = characterCounts.get(genre) || new Map();
      const char = primaryCharacter(ts, genre), cats = categoryCounts.get(categoryKey(genre, char)) || new Map();
      const cat = ts.filter(t => kinds[t] === 'category').sort((a, b) => (cats.get(b) || 0) - (cats.get(a) || 0) || compareText(a, b))[0] || '';
      return { f, ts, genre, cat, char, catCount: cats.get(cat) || 0, charCount: n.get(char) || 0, loved: !!(gallery.loved || {})[f.id] };
    });
    const stage = d => d.loved ? 0 : d.ts.length ? 1 : 2;
    function hierarchy(a, b) {
      const s = stage(a) - stage(b);
      if (s) return s;
      if (a.loved || !a.ts.length) return 0;
      return (a.genre === b.genre ? 0 : !a.genre ? 1 : !b.genre ? -1 : ranked(a.genre, b.genre))
        || (a.char === b.char ? 0 : !a.char ? 1 : !b.char ? -1 : b.charCount - a.charCount || compareText(a.char, b.char))
        || (a.cat === b.cat ? 0 : !a.cat ? 1 : !b.cat ? -1 : b.catCount - a.catCount || compareText(a.cat, b.cat))
        || b.ts.length - a.ts.length;
    }
    const signature = d => [...d.ts].sort(compareText);
    function fallback(a, b) {
      if (a.loved || !a.ts.length) return title(a.f, b.f);
      const x = signature(a), y = signature(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = compareText(x[i], y[i]); if (c) return c; }
      return x.length - y.length || title(a.f, b.f);
    }
    data.sort((a, b) => hierarchy(a, b) || fallback(a, b));
    const result = [];
    for (let i = 0; i < data.length;) {
      let end = i + 1;
      while (end < data.length && hierarchy(data[i], data[end]) === 0) end++;
      const bucket = data.slice(i, end);
      if (data[i].loved || !data[i].ts.length) { result.push(...bucket.map(d => d.f)); i = end; continue; }
      let previous = null;
      while (bucket.length) {
        let best = 0, score = -1;
        for (let j = 0; j < bucket.length; j++) {
          const overlap = previous && !bucket[j].loved ? bucket[j].ts.filter(t => previous.has(t)).length : 0;
          if (overlap > score) { best = j; score = overlap; }
        }
        const chosen = bucket.splice(best, 1)[0];
        result.push(chosen.f); previous = new Set(chosen.ts);
      }
      i = end;
    }
    return result;
  }
  const api = { compareText, countTags, sortVideos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryOrder = api;
})(globalThis);
