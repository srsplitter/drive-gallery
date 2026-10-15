const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ensure,sort,move}=require('../manual-order.js');
const order=(ids,ranks)=>sort(ids.map(id=>({id})),ensure(ids,ranks)).map(f=>f.id);
test('manual placement uses independent coordinates and keeps deleted IDs',()=>{
  const ranks=move(['a','b','c','d','e'],{},['d'],'b');
  assert.deepEqual(order(['a','b','c','d','e'],ranks),['a','d','b','c','e']);
  assert.deepEqual(order(['d','e'],ranks),['d','e']);
  assert.deepEqual(ensure(['d'],ranks),ranks);
  assert.deepEqual(order(['a','b','c','d','e'],JSON.parse(JSON.stringify(ranks))),['a','d','b','c','e']);
});
test('new automatic entries insert without altering any saved coordinates',()=>{
  const ranks=move(['a','b','c','d','e'],{},['d'],'b');
  const expanded=ensure(['a','x','b','c','d','e','z'],ranks);
  for(const [id,value] of Object.entries(ranks))assert.equal(expanded[id],value);
  assert.deepEqual(order(['a','x','b','c','d','e','z'],expanded),['a','d','x','b','c','e','z']);
  assert.equal(new Set(Object.values(expanded)).size,Object.keys(expanded).length);
});
test('whole series moves together in saved internal order',()=>{
  const ranks=move(['a','b','c','d','e'],{},['c','b'],'a');
  assert.deepEqual(order(['a','b','c','d','e'],ranks),['c','b','a','d','e']);
});
test('repeated drops keep finite distinct coordinates and never mutate input',()=>{
  const original=ensure(['a','b','c']);let ranks={...original};
  for(let n=0;n<120;n++){ranks=move(['a','b','c'],ranks,[n%2?'b':'c'],'a');}
  assert.equal(new Set(Object.values(ranks)).size,3);
  assert.ok(Object.values(ranks).every(Number.isFinite));
  assert.deepEqual(original,ensure(['a','b','c']));
});
test('many new automatic insertions never collide with saved slots',()=>{
  let ranks=ensure(['a','b']);let previous='a';
  for(let n=0;n<100;n++){
    const id='x'+n;
    ranks=ensure([previous,id,'b'],ranks);previous=id;
    assert.equal(new Set(Object.values(ranks)).size,Object.keys(ranks).length);
    assert.ok(ranks[id]<ranks.b);
  }
});
