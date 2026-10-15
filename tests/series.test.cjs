const {test}=require('node:test');
const assert=require('node:assert/strict');
const {arrange}=require('../series.js');
const videos=ids=>ids.map(id=>({id,name:id}));
const ids=list=>list.map(f=>f.id);
test('series follows click order at the first existing member position',()=>{
  assert.deepEqual(ids(arrange(videos(['x','b','y','a','c','z']),{s:{videoIds:['a','b','c']}})),['x','a','b','c','y','z']);
});
test('does not insert videos outside current search or hidden videos',()=>{
  assert.deepEqual(ids(arrange(videos(['x','c','a','z']),{s:{videoIds:['a','b','c','missing']}})),['x','a','c','z']);
});
test('multiple groups appear once without duplicating overlapping legacy members',()=>{
  assert.deepEqual(ids(arrange(videos(['d','x','b','a','c']),{s:{videoIds:['a','b','a']},t:{videoIds:['c','d','b']}})),['c','d','x','a','b']);
});
test('invalid and empty series do not break normal order',()=>{
  assert.deepEqual(ids(arrange(videos(['b','a']),{s:null,t:{},u:{videoIds:[]}})),['b','a']);
});
test('keeps input objects and saved membership unchanged',()=>{
  const list=videos(['b','a']),series={s:{name:'마리오 게임 1',videoIds:['a','b']}};
  const before=JSON.stringify({list,series});const out=arrange(list,series);
  assert.equal(JSON.stringify({list,series}),before);assert.equal(out[0],list[1]);
});
