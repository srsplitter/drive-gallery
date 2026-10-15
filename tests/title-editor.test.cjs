const {test}=require('node:test'),assert=require('node:assert/strict');
const {planRename,removeWords}=require('../title-editor.js');
test('number only the supplied visible order and preserve extensions',()=>{
  const files=[{id:'c',name:'old.MOV'},{id:'a',name:'other.mp4'}];
  assert.deepEqual(planRename(files,'마리오').map(p=>[p.file.id,p.name]),[['c','마리오1.MOV'],['a','마리오2.mp4']]);
  assert.equal(planRename([files[0]],'마리오')[0].name,'마리오.MOV');
  assert.equal(planRename([{name:'clip.m2v'}],'new')[0].name,'new.m2v');
  assert.equal(removeWords('clip.m2v','m2v'),'clip.m2v');
});
test('remove exact Unicode words without stripping prefixes',()=>{
  assert.equal(removeWords('Mario 마리오.mp4','mar 마법사 마'),'Mario 마리오.mp4');
  assert.equal(removeWords('Mario 마리오 Galaxy.mp4','mario 마리오'),'Galaxy.mp4');
  assert.equal(removeWords('SuperMario Mario2.mp4','Mario'),'SuperMario Mario2.mp4');
  assert.equal(removeWords('Mario,마리오 sequel.MOV','Mario 마리오'),', sequel.MOV');
  assert.equal(removeWords('마리오.mp4','마리오'),null);
});
