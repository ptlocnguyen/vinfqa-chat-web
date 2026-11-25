import test from 'node:test';
import assert from 'node:assert/strict';
import {UI_MODEL_IDS,modelForSession,uiModelCapabilities,validateImageCount} from '../assets/model-registry.mjs';

test('legacy health keeps S3 usable and M7 disabled',()=>{
  const models=uiModelCapabilities({capabilities:{max_new_tokens:[32,64,128],extended_demo:true}});
  assert.deepEqual(models[0].max_new_tokens,[32]);assert.deepEqual(models[1].max_new_tokens,[64,128]);assert.equal(models[2].enabled,false);
});
test('server capability is authoritative for M7 availability',()=>{
  const models=uiModelCapabilities({capabilities:{max_new_tokens:[32],models:[
    {model_id:'s3-v04-4b',enabled:true},{model_id:'m7-7b-nb136',enabled:true,verification_status:'VERIFIED'}]}});
  assert.equal(modelForSession(models,UI_MODEL_IDS.M7).model_id,UI_MODEL_IDS.M7);
  assert.equal(validateImageCount(models[2],2),true);assert.equal(validateImageCount(models[2],4),true);
  assert.equal(validateImageCount(models[2],1),false);assert.equal(validateImageCount(models[2],5),false);
});
