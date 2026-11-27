import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantModelLabel,provenanceBranch,provenancePresentation,supportedTokenLimits} from '../assets/inference-mode.mjs';

test('Extended options require both UI flag and verified gateway capability',()=>{
  const health={capabilities:{max_new_tokens:[32,64,128],extended_demo:true}};
  assert.deepEqual(supportedTokenLimits(health,false),[32]);
  assert.deepEqual(supportedTokenLimits(health,true),[32,64,128]);
  assert.deepEqual(supportedTokenLimits({capabilities:{max_new_tokens:[32,64,128],extended_demo:false}},true),[32]);
  assert.deepEqual(supportedTokenLimits({capabilities:{max_new_tokens:[64],extended_demo:true}},true),[32,64]);
});

test('legacy v04 history remains labeled with the real 32-token limit',()=>{
  const view=provenancePresentation({inference_mode:'SSRC_V04',output_tokens:3,requested_max_new_tokens:32,max_new_tokens:32,verification_status:'VERIFIED',possible_truncation:false});
  assert.equal(view.modeLabel,'SSRC v04');
  assert.equal(view.tokenLabel,'3/32 tokens');
  assert.equal(view.truncation,'');
});

test('M7 missing, invalid, or contradictory cap is never shown as verified or as 32 tokens',()=>{
  for(const metadata of [
    {inference_mode:'M7_MULTI_IMAGE_DEMO',output_tokens:5},
    {inference_mode:'M7_MULTI_IMAGE_DEMO',output_tokens:5,max_new_tokens:32,verification_status:'VERIFIED'},
  ]){
    const view=provenancePresentation(metadata);
    assert.equal(view.verified,false);assert.equal(view.limit,null);
    assert.match(view.tokenLabel,/NOT_VERIFIED/);
  }
  const overCap=provenancePresentation({inference_mode:'M7_MULTI_IMAGE_DEMO',output_tokens:97,max_new_tokens:96,verification_status:'VERIFIED'});
  assert.equal(overCap.limit,96);assert.equal(overCap.verified,false);assert.match(overCap.tokenLabel,/NOT_VERIFIED/);
});

test('M7 valid verified provenance keeps the actual fixed 96-token limit',()=>{
  const view=provenancePresentation({inference_mode:'M7_MULTI_IMAGE_DEMO',output_tokens:3,max_new_tokens:96,verification_status:'VERIFIED',possible_truncation:false});
  assert.equal(view.limit,96);assert.equal(view.verified,true);assert.equal(view.tokenLabel,'3/96 tokens');
});

test('model identity follows M7 mode and does not invent an S3 branch',()=>{
  assert.equal(assistantModelLabel('m7-7b-nb136',{}),'M7 QLoRA 7B · Trợ lý multi-image');
  assert.equal(assistantModelLabel(null,{inference_mode:'M7_MULTI_IMAGE_DEMO'}),'M7 QLoRA 7B · Trợ lý multi-image');
  assert.equal(assistantModelLabel('s3-v04-4b',{inference_mode:'M7_MULTI_IMAGE_DEMO'}),'M7 QLoRA 7B · Trợ lý multi-image');
  assert.equal(provenanceBranch({inference_mode:'M7_MULTI_IMAGE_DEMO'}),null);
  assert.equal(provenanceBranch({route_predicted:'frozen'}),'frozen');
});

test('verified Extended provenance displays actual limit and truncation',()=>{
  const view=provenancePresentation({
    inference_mode:'EXTENDED_DEMO',verification_status:'VERIFIED',
    output_tokens:64,max_new_tokens:64,possible_truncation:true,
  });
  assert.equal(view.modeLabel,'Extended Demo');
  assert.equal(view.tokenLabel,'64/64 tokens');
  assert.equal(view.truncation,'Có thể bị cắt ở 64 tokens');
  assert.equal(view.verified,true);
});

test('unverified Extended metadata is never presented as verified',()=>{
  const view=provenancePresentation({inference_mode:'EXTENDED_DEMO',output_tokens:60});
  assert.match(view.tokenLabel,/NOT_VERIFIED/);
  assert.match(view.truncation,/NOT_VERIFIED/);
  assert.equal(view.verified,false);
});
