const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planCollisionRename}=require('../title-editor.js');
const base=name=>name.replace(/\.[^.]+$/u,'').normalize('NFKC').toLowerCase();
function execute(files,source,target){
  const before=JSON.stringify(files);
  const plan=planCollisionRename(files,source,target);
  assert.equal(JSON.stringify(files),before,'planning must not mutate loaded names');
  for(const operation of plan){
    assert.ok(!files.some(f=>f.id!==operation.file.id&&base(f.name)===base(operation.name)),
      'occupied destination: '+operation.name);
    operation.file.name=operation.name;
  }
  return plan;
}
test('numeric insertion is collision-free across gaps, indices and same-family moves',()=>{
  for(const numbers of [[1,2,3,4,5],[2,10,20],[1,3,9]]){
    for(const target of [1,2,3,4,5,10,20]){
      for(const moving of ['external',...numbers]){
        const files=numbers.map(n=>({id:String(n),name:'Mario'+n+'.mp4'}));
        if(moving==='external')files.push({id:'external',name:'Luigi.mov'});
        const source=files.find(f=>f.id===String(moving));
        const wanted='Mario'+target+(moving==='external'?'.mov':'.mp4');
        execute(files,source,wanted);
        assert.equal(source.name,wanted);
        assert.equal(new Set(files.map(f=>base(f.name))).size,files.length);
      }
    }
  }
});
test('unnumbered duplicate allocates numbers without changing extensions or unrelated prefix',()=>{
  const files=[{id:'a',name:'Mario.mp4'},{id:'b',name:'Mario2.mov'},
    {id:'x',name:'MarioKart1.mp4'},{id:'c',name:'Luigi.webm'}];
  execute(files,files[3],'Mario.webm');
  assert.deepEqual(files.map(f=>f.name),['Mario3.mp4','Mario2.mov','MarioKart1.mp4','Mario4.webm']);
});
