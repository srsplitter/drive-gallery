const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortVideos, compareText } = require('../gallery-order.js');
const f = (id, name = id) => ({ id, name });
test('favorites, popular category, popular character, then tag count', () => {
  const list = ['film','luigi','mario1','mario2','mario3','plain','none','fav'].map(x => f(x));
  const gallery = { loved: { fav: true }, tagKinds: { 게임: 'category', 영화: 'category', 마리오: 'character', 루이지: 'character' }, tags: {
    film: ['영화'], luigi: ['게임','루이지','많음','추가'], mario1: ['게임','마리오'],
    mario2: ['게임','마리오','버섯'], mario3: ['게임','마리오','버섯','불꽃'], plain: ['일반'], fav: [],
  } };
  assert.deepEqual(sortVideos(list, gallery).map(x => x.id), ['fav','mario3','mario2','mario1','luigi','film','plain','none']);
});
test('equal tag counts cluster overlap before alphabetical fallback', () => {
  const list = ['c','b','a'].map(x => f(x));
  const gallery = { tags: { a: ['가','공통','첫째'], b: ['나','별개','다름'], c: ['다','공통','첫째'] } };
  const ids = sortVideos(list, gallery).map(x => x.id);
  assert.deepEqual(ids, ['a','c','b']);
});
test('special characters, letters, numbers; untagged titles last', () => {
  assert.deepEqual(['3','나','@','가'].sort(compareText), ['@','가','나','3']);
  const list = [f('n','1'), f('k','가'), f('s','!'), f('t','z')];
  assert.deepEqual(sortVideos(list, { tags: { t: ['태그'] } }).map(x => x.id), ['t','s','k','n']);
});
test('category popularity uses full universe even in filtered results', () => {
  const list = [f('a'),f('b'),f('c'),f('d')];
  const gallery = { tagKinds: { 게임:'category', 영화:'category' }, tags: { a:['게임'],b:['게임'],c:['게임'],d:['영화'] } };
  assert.deepEqual(sortVideos([list[3],list[0]], gallery, list).map(x => x.id), ['a','d']);
});
test('does not mutate source videos or saved tags', () => {
  const list = [f('a'), f('b')], gallery = { tags: { a:['z','a'], b:['b'] } };
  const before = JSON.stringify({ list, gallery }); sortVideos(list, gallery);
  assert.equal(JSON.stringify({ list, gallery }), before);
});
test('favorites ignore category and tag count', () => {
  const list=[f('b','나'),f('a','가'),f('c','!')];
  const gallery={loved:{a:true,b:true},tags:{b:['게임','많음'],c:['게임']},tagKinds:{게임:'category'}};
  assert.deepEqual(sortVideos(list,gallery).map(x=>x.id),['a','b','c']);
});
test('multiple categories choose largest category and character counts are local', () => {
  const list=['g1','g2','g3','f1','f2'].map(x=>f(x));
  const gallery={tagKinds:{게임:'category',영화:'category',마리오:'character',루이지:'character'},tags:{
    g1:['게임','마리오'],g2:['게임','마리오'],g3:['게임','영화','루이지'],f1:['영화','루이지'],f2:['영화','마리오'],
  }};
  // 게임/영화 동률이면 가나다순 게임을 대표 카테고리로 사용.
  const ids=sortVideos(list,gallery).map(x=>x.id);
  assert.ok(ids.indexOf('g1')<ids.indexOf('g3'));
  assert.ok(ids.indexOf('g2')<ids.indexOf('g3'));
  assert.ok(ids.indexOf('g3')<ids.indexOf('f1'));
});
