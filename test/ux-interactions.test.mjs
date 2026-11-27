import test from 'node:test';
import assert from 'node:assert/strict';
import {backendForUiChoice,modelGroup,uiModelCapabilities,UI_MODEL_IDS} from '../assets/model-registry.mjs';
import {disambiguateNames,imageSha256,moveItem,removeItem} from '../assets/image-items.mjs';
import {recallQuestion} from '../assets/question-recall.mjs';

const models=uiModelCapabilities({capabilities:{extended_demo:true,max_new_tokens:[32,64,128],models:[
  {model_id:UI_MODEL_IDS.V04,enabled:true},{model_id:UI_MODEL_IDS.EXTENDED,enabled:true},{model_id:UI_MODEL_IDS.M7,enabled:true},
]}});

test('two UI groups route 32/64/128/96 to unchanged backend IDs',()=>{
  assert.equal(backendForUiChoice('qwen4b',32,models)?.model_id,UI_MODEL_IDS.V04);
  for(const limit of [64,128])assert.equal(backendForUiChoice('qwen4b',limit,models)?.model_id,UI_MODEL_IDS.EXTENDED);
  assert.equal(backendForUiChoice('m7',96,models)?.model_id,UI_MODEL_IDS.M7);
  assert.equal(modelGroup(UI_MODEL_IDS.EXTENDED),'qwen4b');
  assert.equal(modelGroup(UI_MODEL_IDS.M7),'m7');
});

test('unavailable capability and invalid limit never silently fall back',()=>{
  const disabled=models.map(item=>item.model_id===UI_MODEL_IDS.EXTENDED?{...item,enabled:false}:item);
  assert.equal(backendForUiChoice('qwen4b',64,disabled),null);
  assert.equal(backendForUiChoice('qwen4b',128,disabled),null);
  assert.equal(backendForUiChoice('m7',64,models),null);
  assert.equal(backendForUiChoice('qwen4b',96,models),null);
});

test('duplicate filenames disambiguate without stealing a preexisting numbered name',()=>{
  const items=[{id:'a',file:{name:'infographic.png'}},{id:'b',file:{name:'infographic.png'}},{id:'c',file:{name:'infographic (2).png'}}];
  const result=disambiguateNames(items);
  assert.deepEqual(result.map(item=>item.displayName),['infographic.png','infographic (3).png','infographic (2).png']);
  assert.deepEqual(result.map(item=>item.file),items.map(item=>item.file));
  assert.deepEqual(moveItem(result,'c',0).map(item=>item.id),['c','a','b']);
  assert.deepEqual(disambiguateNames(moveItem(result,'b',0)).map(item=>item.displayName),['infographic (3).png','infographic.png','infographic (2).png']);
  assert.deepEqual(removeItem(result,'b').map(item=>item.id),['a','c']);
});

test('content digest detects identical bytes across different filenames',async()=>{
  const a=new Blob(['synthetic image bytes']);const b=new Blob(['synthetic image bytes']);const c=new Blob(['different bytes']);
  assert.equal(await imageSha256(a),await imageSha256(b));
  assert.notEqual(await imageSha256(a),await imageSha256(c));
});

test('question recall uses only current session user text and restores draft',()=>{
  const messages=[{role:'user',text:'Một?'},{role:'assistant',text:'Không recall'},{role:'user',text:'Hai?'}];
  const first=recallQuestion(messages,-1,'','up','');assert.equal(first.value,'Hai?');
  const older=recallQuestion(messages,first.index,first.draft,'up',first.value);assert.equal(older.value,'Một?');
  const newer=recallQuestion(messages,older.index,older.draft,'down',older.value);assert.equal(newer.value,'Hai?');
  const draft=recallQuestion(messages,newer.index,newer.draft,'down',newer.value);assert.equal(draft.value,'');
  assert.equal(recallQuestion(messages,-1,'','up','Đang sửa nhiều dòng'),null);
  assert.equal(recallQuestion(messages,-1,'','down',''),null);
});
