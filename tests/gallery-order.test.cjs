const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortVideos, compareText } = require('../gallery-order.js');
const f = (id, name = id) => ({ id, name });
test('favorites, popular character, category, then tag count', () => {
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
test('without genres, character popularity precedes multiple categories', () => {
  const list=['g1','g2','g3','f1','f2'].map(x=>f(x));
  const gallery={tagKinds:{게임:'category',영화:'category',마리오:'character',루이지:'character'},tags:{
    g1:['게임','마리오'],g2:['게임','마리오'],g3:['게임','영화','루이지'],f1:['영화','루이지'],f2:['영화','마리오'],
  }};
  // 장르가 없으면 전체 캐릭터 인기도에서 마리오가 루이지보다 먼저 온다.
  const ids=sortVideos(list,gallery).map(x=>x.id);
  assert.ok(ids.indexOf('g1')<ids.indexOf('g3'));
  assert.ok(ids.indexOf('g2')<ids.indexOf('g3'));
  assert.ok(ids.indexOf('g3')<ids.indexOf('f1'));
});

test('genre > character > category > normal tags, with missing levels last', () => {
  const list = ['none','normal','cat','char','genre','genreCat','genreChar','all'].map(x => f(x));
  const gallery = { tagKinds: { G:'genre', C:'character', K:'category' }, tags: {
    normal:['x','y','z'], cat:['K','x'], char:['C'], genre:['G'],
    genreCat:['G','K'], genreChar:['G','C'], all:['G','C','K'],
  } };
  assert.deepEqual(sortVideos(list, gallery).map(x => x.id),
    ['all','genreChar','genreCat','genre','char','cat','normal','none']);
});

test('primary genre uses full universe popularity and deterministic text ties', () => {
  const gallery = { tagKinds: { A:'genre', B:'genre' }, tags: {
    multi:['A','B'], a:['A','extra','extra2'], b:['B'], b2:['B'],
  } };
  const list = ['multi','a'].map(x => f(x));
  const universe = ['multi','a','b','b2'].map(x => f(x));
  assert.deepEqual(sortVideos(list, gallery, universe).map(x => x.id), ['multi','a']);
  assert.deepEqual(sortVideos(list, gallery, universe.slice(0,3)).map(x => x.id), ['a','multi']);
});

test('character popularity is local to primary genre, including multi-genre videos', () => {
  const tags = { x:['G','X'], y:['G','Y'], multi:['G','H','X','Y'], support:['G','X'] };
  for (let i=0;i<8;i++) tags['outside'+i] = ['H','Y'];
  // Make G primary for multi while Y remains globally more popular than X.
  for (let i=0;i<10;i++) tags['genre'+i] = ['G'];
  const gallery = { tags, tagKinds: { G:'genre', H:'genre', X:'character', Y:'character' } };
  const universe = Object.keys(tags).map(x => f(x));
  assert.deepEqual(sortVideos(['y','x','multi'].map(x => f(x)), gallery, universe).map(x => x.id), ['multi','x','y']);
});

test('primary category uses popularity within genre and primary character, from full universe', () => {
  const tags = { multi:['G','X','A','B'], a:['G','X','A','extra'], b:['G','X','B','extra'], support:['G','X','A'] };
  for (let i=0;i<8;i++) tags['otherCharacter'+i] = ['G','Y','B'];
  for (let i=0;i<12;i++) tags['otherGenre'+i] = ['H','X','B'];
  const gallery = { tags, tagKinds: { G:'genre', H:'genre', X:'character', Y:'character', A:'category', B:'category' } };
  const universe = Object.keys(tags).map(x => f(x));
  const list = ['b','multi','a'].map(x => f(x));
  const before = JSON.stringify({list, universe, gallery});
  assert.deepEqual(sortVideos(list, gallery, universe).map(x => x.id), ['multi','a','b']);
  assert.equal(JSON.stringify({list, universe, gallery}), before);
});
