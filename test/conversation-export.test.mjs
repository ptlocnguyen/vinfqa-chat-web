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

test('export retains safe request diagnostics and model identity while removing secrets',()=>{
  const meta={status:'INFERENCE_COMPLETED',request_id:'request-1',model_id:'m7-7b-nb136',
    base_model_id:'Qwen/Qwen2.5-VL-7B-Instruct',base_model_revision:'cc594898137f460bfe9f0759e9844b3ce807cfb5',
    adapter_sha256:'78065f44555a6fbee907400c61fe6e6121ac31f70b5dc4468964634b103eb131',
    artifact_revision:'a3c1de52625fb5ce6d810c8bccfecef6bb55c013',input_tokens:123,output_tokens:3,
    requested_max_new_tokens:96,max_new_tokens:96,image_count:4,possible_truncation:false,
    timestamp:'2026-11-27T08:00:00Z',HF_TOKEN:'private'};
  const data=exportConversation({modelId:'m7-7b-nb136',messages:[{role:'assistant',text:'85',meta}]},[]);
  assert.equal(data.conversation.messages[0].provenance.request_id,'request-1');
  assert.equal(data.conversation.messages[0].provenance.base_model_revision,meta.base_model_revision);
  assert.equal(data.conversation.messages[0].provenance.HF_TOKEN,undefined);
  assert.match(conversationMarkdown(data),/request-1/);
  const failure=safeProvenance({status:'ERROR',error_code:'BACKEND_STARTING',http_status:503,request_id:'request-2'});
  assert.deepEqual(failure,{status:'ERROR',request_id:'request-2',error_code:'BACKEND_STARTING',http_status:503});
});

test('known credential patterns in exported conversation text are redacted',()=>{
  const data=exportConversation({modelId:'s3-v04-4b',messages:[{role:'user',text:'key hf_abcdefghijklmnopqrstuvwxyz123456 and Bearer abcdefghijklmnopqrstuvwxyz012345'}]},[]);
  assert.equal(data.conversation.messages[0].text,'key [REDACTED] and [REDACTED]');
});
