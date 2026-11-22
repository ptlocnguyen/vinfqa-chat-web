import test from 'node:test';
import assert from 'node:assert/strict';
import {provenancePresentation,supportedTokenLimits} from '../assets/inference-mode.mjs';

test('Extended options require both UI flag and verified gateway capability',()=>{
  const health={capabilities:{max_new_tokens:[32,64,128],extended_demo:true}};
  assert.deepEqual(supportedTokenLimits(health,false),[32]);
  assert.deepEqual(supportedTokenLimits(health,true),[32,64,128]);
  assert.deepEqual(supportedTokenLimits({capabilities:{max_new_tokens:[32,64,128],extended_demo:false}},true),[32]);
  assert.deepEqual(supportedTokenLimits({capabilities:{max_new_tokens:[64],extended_demo:true}},true),[32,64]);
});

test('legacy v04 history remains labeled with the real 32-token limit',()=>{
  const view=provenancePresentation({output_tokens:3,possible_truncation:false});
  assert.equal(view.modeLabel,'SSRC v04');
  assert.equal(view.tokenLabel,'3/32 tokens');
  assert.equal(view.truncation,'');
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
