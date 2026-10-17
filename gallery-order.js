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
    const numberedTitle = f => {
      const name = String(f.name || '').normalize('NFKC').trim().toLowerCase()
        .replace(/\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|ogv)$/i, '');
      const match = /^(.*?)([0-9]+)$/.exec(name);
      if (!match || !match[1].trim() || !/[^0-9\s]/.test(match[1])) return null;
      return { stem: match[1].trim(), index: BigInt(match[2]) };
    };
    const familyKey = (f, number) => {
      const genre = primaryGenre(f);
      return JSON.stringify([genre, primaryCharacter(tags(f), genre), number.stem]);
    };
    const families = new Map();
    for (const f of universe) {
      const number = numberedTitle(f);
      if (!number) continue;
      const key = familyKey(f, number);
      if (!families.has(key)) families.set(key, new Set());
      families.get(key).add(number.index);
    }
    const title = (a, b) => compareText(a.name, b.name) || compareText(a.id, b.id);
    const data = list.map(f => {
      const ts = tags(f), genre = primaryGenre(f), n = characterCounts.get(genre) || new Map();
      const char = primaryCharacter(ts, genre), cats = categoryCounts.get(categoryKey(genre, char)) || new Map();
      const cat = ts.filter(t => kinds[t] === 'category').sort((a, b) => (cats.get(b) || 0) - (cats.get(a) || 0) || compareText(a, b))[0] || '';
      const number = numberedTitle(f);
      const family = number && (families.get(familyKey(f, number)) || new Set()).size >= 2 ? number : null;
      return { f, ts, genre, cat, char, family, catCount: cats.get(cat) || 0, charCount: n.get(char) || 0, loved: !!(gallery.loved || {})[f.id],
        familyKey: family ? familyKey(f, number) : null };
    });
    // 번호 제목 묶음은 한 덩어리: 묶음 전체가 구성원 중 가장 많이 쓰인 카테고리를 따름 (카테고리로 묶음이 쪼개지지 않게)
    const familyCat = new Map();
    for (const d of data) {
      if (!d.familyKey || !d.cat) continue;
      const best = familyCat.get(d.familyKey);
      if (!best || d.catCount > best.catCount || (d.catCount === best.catCount && compareText(d.cat, best.cat) < 0)) familyCat.set(d.familyKey, { cat: d.cat, catCount: d.catCount });
    }
    for (const d of data) if (d.familyKey && familyCat.has(d.familyKey)) Object.assign(d, familyCat.get(d.familyKey));
    const stage = d => d.loved ? 0 : d.ts.length || d.family ? 1 : 2;
    const compareFamily = (a, b) => {
      if (!a.family || !b.family) return a.family ? -1 : b.family ? 1 : 0;
      return compareText(a.family.stem, b.family.stem)
        || (a.family.index < b.family.index ? -1 : a.family.index > b.family.index ? 1 : 0);
    };
    function hierarchy(a, b) {
      const s = stage(a) - stage(b);
      if (s) return s;
      if (a.loved || stage(a) === 2) return 0;
      return (a.genre === b.genre ? 0 : !a.genre ? 1 : !b.genre ? -1 : ranked(a.genre, b.genre))
        || (a.char === b.char ? 0 : !a.char ? 1 : !b.char ? -1 : b.charCount - a.charCount || compareText(a.char, b.char))
        // 카테고리를 번호 제목 묶음보다 먼저: 제목 앞부분 순서 때문에 같은 카테고리가 흩어지지 않게
        || (a.cat === b.cat ? 0 : !a.cat ? 1 : !b.cat ? -1 : b.catCount - a.catCount || compareText(a.cat, b.cat))
        || compareFamily(a, b)
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
