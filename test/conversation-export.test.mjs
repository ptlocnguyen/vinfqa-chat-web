import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationMarkdown,exportConversation,safeProvenance} from '../assets/conversation-export.mjs';

test('conversation export preserves ordered image metadata and excludes image data and credentials',()=>{
  const session={id:'c1',title:'Demo',modelId:'m7-7b-nb136',images:[
    {file:{name:'north.png',size:10,data:'private'}},{file:{name:'south.png',size:20}},
  ],messages:[{role:'user',text:'Compare',createdAt:'2026-11-27T00:00:00Z',modelId:'m7-7b-nb136'},{role:'assistant',text:'Answer',meta:{inference_mode:'M7_MULTI_IMAGE_DEMO',output_tokens:3,max_new_tokens:96,verification_status:'VERIFIED',HF_TOKEN:'secret',image_bytes:'private'}}]};
  const data=exportConversation(session,[{model_id:'m7-7b-nb136',label:'M7'}],'2026-11-27T00:00:01Z');
  assert.deepEqual(data.conversation.images.map((image)=>image.order),[1,2]);
  assert.equal(data.conversation.messages[1].provenance.HF_TOKEN,undefined);
  assert.equal(JSON.stringify(data).includes('secret'),false);
  assert.equal(JSON.stringify(data).includes('private'),false);
  assert.match(conversationMarkdown(data),/Ảnh 2 \(20 bytes\)/);
});

test('provenance export only includes allowlisted scalar fields',()=>{
  assert.deepEqual(safeProvenance({output_tokens:3,selected_branch:'frozen',token:'secret',internal_path:'/private'}),{output_tokens:3,selected_branch:'frozen'});
});

test('known credential patterns in exported conversation text are redacted',()=>{
  const data=exportConversation({modelId:'s3-v04-4b',messages:[{role:'user',text:'key hf_abcdefghijklmnopqrstuvwxyz123456 and Bearer abcdefghijklmnopqrstuvwxyz012345'}]},[]);
  assert.equal(data.conversation.messages[0].text,'key [REDACTED] and [REDACTED]');
});
