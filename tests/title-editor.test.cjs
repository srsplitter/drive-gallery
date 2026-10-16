const {test}=require('node:test'),assert=require('node:assert/strict');
const {planRename,removeWords,matchesKinds,getSuggestions}=require('../title-editor.js');
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
test('explicit dotted suffix removes extension only on exact match',()=>{
  assert.equal(removeWords('Mario.mp4','.mp4'),'Mario');
  assert.equal(removeWords('Mario.MP4','.mp4'),'Mario');
  assert.equal(removeWords('Mario.mp4','.mp'),'Mario.mp4');
  assert.equal(removeWords('Mario.mp4','mp4'),'Mario.mp4');
  assert.equal(removeWords('mp4 clip.mp4','.mp4'),'mp4 clip');
  assert.equal(removeWords('Mario clip.mp4','Mario, .mp4'),'clip');
  assert.equal(removeWords('clip.mov','.mp4'),'clip.mov');
  assert.equal(removeWords('.mp4','.mp4'),null);
});
test('kind searches match only their own taxonomy and combine with series',()=>{
  const file={id:'a'},data={tags:{a:['Mario','게임']},tagKinds:{Mario:'character',게임:'category'},series:{s:{name:'Mario 연작',videoIds:['a']}}};
  assert.equal(matchesKinds(file,{normal:'mario'},data),false);
  assert.equal(matchesKinds(file,{character:'mario',category:'게임',series:'연작'},data),true);
  assert.equal(matchesKinds(file,{character:'mario',genre:'게임'},data),false);
});
test('title-specific query never matches tag names',()=>{
  const file={id:'a',name:'Sample.MP4'},data={tags:{a:['Mario']}};
  assert.equal(matchesKinds(file,{title:'mario'},data),false);
  assert.equal(matchesKinds(file,{title:'sample'},data),true);
  assert.equal(matchesKinds(file,{title:'sample',normal:'mario'},data),true);
});
test('suggestions include other kinds and exact selection excludes similar names',()=>{
  const data={tags:{a:['Mario'],b:['SuperMario'],c:['MarioKart']},tagKinds:{Mario:'character',SuperMario:'character',MarioKart:'genre'},series:{s:{name:'Mario series',videoIds:['a']}}};
  const suggestions=getSuggestions('mario','genre',data);
  assert.equal(suggestions[0].kind,'genre');
  assert.ok(suggestions.some(s=>s.kind==='character'&&s.value==='Mario'));
  assert.ok(suggestions.some(s=>s.kind==='series'));
  assert.deepEqual(getSuggestions('','normal',data),[]);
  assert.deepEqual(getSuggestions('mario','title',data),[]);
  assert.equal(matchesKinds({id:'b'},{character:'Mario'},data,{character:'Mario'}),false);
  assert.equal(matchesKinds({id:'b'},{character:'Mario'},data),true);
  const crowded={tags:{a:Array.from({length:15},(_,i)=>'Mario'+i).concat('MarioCategory')},tagKinds:{MarioCategory:'category'}};
  assert.ok(getSuggestions('mario','normal',crowded).some(s=>s.kind==='category'));
  assert.ok(getSuggestions('mario','normal',crowded).length<=12);
});
