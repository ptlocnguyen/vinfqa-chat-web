import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {UI_MODEL_IDS} from '../assets/model-registry.mjs';
import {SAMPLE_IMAGES,SAMPLE_SCENARIOS,compatibleModels,validateResearchTrial,makeResearchForm,checkedResult,researchExport,researchCsv,researchMarkdown} from '../assets/research-core.mjs';

const health={status:'ready',capabilities:{max_new_tokens:[32,64,128],models:[
  {model_id:UI_MODEL_IDS.V04,enabled:true,max_new_tokens:[32]},
  {model_id:UI_MODEL_IDS.EXTENDED,enabled:true,max_new_tokens:[64,128]},
  {model_id:UI_MODEL_IDS.M7,enabled:true,max_new_tokens:[96]},
]}};
const file=new File([new Uint8Array([137,80,78,71])],'fixture.png',{type:'image/png'});
const image={file,sha256:'a'.repeat(64),source:'uploaded'};

test('synthetic library answers match locked PNG bytes and arithmetic',async()=>{
  for(const sample of Object.values(SAMPLE_IMAGES)){
    const path=fileURLToPath(new URL(`../${sample.path.slice(2)}`,import.meta.url));
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),sample.sha256);
    assert.equal(sample.months.reduce((a,b)=>a+b,0),Number(sample.months[0]+sample.months[1]+sample.months[2]));
    assert.equal(sample.international+sample.domestic,sample.months[1]);
  }
  assert.equal(SAMPLE_SCENARIOS.find(item=>item.id==='compare-abcd').reference,'85');
  assert.equal(SAMPLE_SCENARIOS.find(item=>item.id==='math-a-quarter').reference,'72');
  assert.equal(SAMPLE_SCENARIOS.find(item=>item.id==='compare-ab').reference,'7');
});

test('research capabilities fail closed and enforce image count plus advertised limits',()=>{
  assert.deepEqual(compatibleModels(null,1),[]);
  assert.deepEqual(compatibleModels({...health,status:'paused'},1),[]);
  assert.deepEqual(compatibleModels(health,1).map(m=>[m.model_id,m.max_new_tokens]),[[UI_MODEL_IDS.V04,[32]],[UI_MODEL_IDS.EXTENDED,[64,128]]]);
  assert.deepEqual(compatibleModels(health,4).map(m=>m.model_id),[UI_MODEL_IDS.M7]);
  const changed=structuredClone(health);changed.capabilities.models[1].max_new_tokens=[64];
  assert.deepEqual(compatibleModels(changed,1)[1].max_new_tokens,[64]);
});

test('each trial builds only its selected Gateway route and does not include auth or history fields',()=>{
  const one=compatibleModels(health,1),multi=compatibleModels(health,4);
  for(const [modelId,tokens,images,available,route] of [
    [UI_MODEL_IDS.V04,32,[image],one,'/infer'],
    [UI_MODEL_IDS.EXTENDED,64,[image],one,'/infer'],
    [UI_MODEL_IDS.EXTENDED,128,[image],one,'/infer'],
    [UI_MODEL_IDS.M7,96,[image,image,image,image],multi,'/infer-multi'],
  ]){
    const trial={modelId,maxNewTokens:tokens,question:'Giá trị tháng 2?'};
    assert.equal(validateResearchTrial(trial,images,available),null);
    const packed=makeResearchForm(trial,images,'mock-turnstile');
    assert.equal(packed.endpoint,route);
    assert.equal(packed.body.get('model_id'),modelId);
    assert.equal(packed.body.get('max_new_tokens'),tokens===32?null:String(tokens));
    assert.equal(packed.body.getAll('images').length,modelId===UI_MODEL_IDS.M7?4:0);
    assert.equal(packed.body.get('image') instanceof File,modelId!==UI_MODEL_IDS.M7);
    assert.equal(packed.body.get('turnstile'),'mock-turnstile');
    assert.equal(packed.body.get('conversation_id'),null);
  }
  assert.ok(validateResearchTrial({modelId:UI_MODEL_IDS.M7,maxNewTokens:96,question:'? Вот'},[image],multi));
  assert.ok(validateResearchTrial({modelId:UI_MODEL_IDS.V04,maxNewTokens:128,question:'? x'},[image],one));
});

test('result contract validates mode, cap, model if present, count and output tokens',()=>{
  const trial={modelId:UI_MODEL_IDS.EXTENDED,maxNewTokens:64};
  const payload={status:'INFERENCE_COMPLETED',answer:'24',request_id:'request-mock',provenance:{inference_mode:'EXTENDED_DEMO',requested_max_new_tokens:64,max_new_tokens:64,output_tokens:3,verification_status:'VERIFIED',elapsed_seconds:1.2}};
  assert.equal(checkedResult(payload,trial,1)?.answer,'24');
  assert.equal(checkedResult({...payload,provenance:{...payload.provenance,inference_mode:'SSRC_V04'}},trial,1),null);
  assert.equal(checkedResult({...payload,provenance:{...payload.provenance,output_tokens:65}},trial,1),null);
  assert.equal(checkedResult({...payload,provenance:{...payload.provenance,model_id:UI_MODEL_IDS.M7}},trial,1),null);
  assert.equal(checkedResult({...payload,provenance:{...payload.provenance,verification_status:'NOT_VERIFIED'}},trial,1),null);
  const m7={...payload,provenance:{...payload.provenance,inference_mode:'M7_MULTI_IMAGE_DEMO',model_id:UI_MODEL_IDS.M7,requested_max_new_tokens:96,max_new_tokens:96,image_count:4}};
  assert.equal(checkedResult(m7,{modelId:UI_MODEL_IDS.M7,maxNewTokens:96},4)?.answer,'24');
  assert.equal(checkedResult(m7,{modelId:UI_MODEL_IDS.M7,maxNewTokens:96},2),null);
});

test('exports preserve ordered hashes and manual assessment while omitting bytes and secrets',()=>{
  const data=researchExport({scenarioId:'chart-a-feb',images:[image,{...image,sha256:'b'.repeat(64)}],trials:[{id:'r1',modelId:UI_MODEL_IDS.EXTENDED,maxNewTokens:64,question:'=2+2',reference:'24',answer:'hf_abcdefghijklmnopqrstuvwxyz012345',status:'PASS',assessment:'INCORRECT',notes:'Không cộng đúng',wallSeconds:2.2,provenance:{inference_mode:'EXTENDED_DEMO',output_tokens:3,verification_status:'VERIFIED',turnstile:'secret',backend_revision:'abc'},requestId:'req-1'}]},'2026-11-28T00:00:00Z');
  assert.deepEqual(data.images.map(item=>item.sha256),['a'.repeat(64),'b'.repeat(64)]);
  assert.equal(data.trials[0].assessment,'INCORRECT');
  assert.equal(data.trials[0].answer,'[REDACTED]');
  assert.equal(data.trials[0].provenance.turnstile,undefined);
  assert.match(researchCsv(data),/"'=2\+2"/);
  assert.match(researchMarkdown(data),/SHA-256/);
  assert.doesNotMatch(JSON.stringify(data),/abcdefghijklmnopqrstuvwxyz012345/);
});
