export const UI_MODEL_IDS = Object.freeze({V04:'s3-v04-4b',EXTENDED:'s3-extended-4b',M7:'m7-7b-nb136'});

// Client routing metadata only. Availability and token limits still come from /health.
export const MODEL_REGISTRY = Object.freeze({
  [UI_MODEL_IDS.V04]:Object.freeze({shortName:'SSRC v04',backbone:'Qwen3-VL-4B',endpoint:'/infer',imageMin:1,imageMax:1,tokenLimits:[32]}),
  [UI_MODEL_IDS.EXTENDED]:Object.freeze({shortName:'Extended 4B',backbone:'Qwen3-VL-4B',endpoint:'/infer',imageMin:1,imageMax:1,tokenLimits:[64,128]}),
  [UI_MODEL_IDS.M7]:Object.freeze({shortName:'M7 QLoRA 7B',backbone:'Qwen2.5-VL-7B',endpoint:'/infer-multi',imageMin:2,imageMax:4,tokenLimits:[96]}),
});

export function researchCapabilities(healthPayload,imageCount) {
  if(healthPayload?.status!=='ready'||!Array.isArray(healthPayload?.capabilities?.models))return [];
  const advertised=new Map(healthPayload.capabilities.models.map(model=>[model?.model_id,model]));
  return uiModelCapabilities(healthPayload)
    .filter(model=>advertised.get(model.model_id)?.enabled===true&&model.enabled&&Number.isInteger(imageCount)&&validateImageCount(model,imageCount))
    .map(model=>({ ...model, ...MODEL_REGISTRY[model.model_id],
      max_new_tokens:model.max_new_tokens.filter(value=>MODEL_REGISTRY[model.model_id].tokenLimits.includes(value)&&advertised.get(model.model_id).max_new_tokens?.includes(value)) }))
    .filter(model=>model.max_new_tokens.length>0);
}

export function backendForUiChoice(group, tokens, models) {
  if(group!=='m7'&&group!=='qwen4b'||group==='m7'&&tokens!==96)return null;
  const id = group === 'm7' ? UI_MODEL_IDS.M7 : tokens === 32 ? UI_MODEL_IDS.V04 : UI_MODEL_IDS.EXTENDED;
  const model = modelForSession(models, id);
  if (!model?.enabled || !model.max_new_tokens.includes(group === 'm7' ? 96 : tokens)) return null;
  return model;
}

export function modelGroup(modelId) { return modelId === UI_MODEL_IDS.M7 ? 'm7' : 'qwen4b'; }

export function uiModelCapabilities(healthPayload) {
  const advertised = Array.isArray(healthPayload?.capabilities?.models)
    ? healthPayload.capabilities.models : [];
  const byId = new Map(advertised.map(item=>[item?.model_id,item]));
  const v04 = byId.get('s3-v04-4b');
  const extended = byId.get('s3-extended-4b');
  const m7 = byId.get(UI_MODEL_IDS.M7);
  const legacyLimits = Array.isArray(healthPayload?.capabilities?.max_new_tokens)
    ? healthPayload.capabilities.max_new_tokens.filter(value=>[32,64,128].includes(value)) : [32];
  return [
    {model_id:UI_MODEL_IDS.V04,label:'Qwen3-VL-4B · SSRC v04',enabled:v04 ? v04.enabled === true : true,
      image_min:1,image_max:1,max_new_tokens:[32]},
    {model_id:UI_MODEL_IDS.EXTENDED,label:'Qwen3-VL-4B · Extended',enabled:extended ? extended.enabled === true : healthPayload?.capabilities?.extended_demo===true,
      image_min:1,image_max:1,max_new_tokens:legacyLimits.filter(value=>value===64||value===128)},
    {model_id:UI_MODEL_IDS.M7,label:'M7 QLoRA 7B · Multi-image',enabled:m7?.enabled === true,
      image_min:2,image_max:4,max_new_tokens:[96],verification_status:m7?.verification_status || 'DISABLED'},
  ];
}

export function modelForSession(models, modelId) {
  return models.find(model=>model.model_id===modelId) || null;
}

export function validateImageCount(model, count) {
  return Number.isInteger(count) && count >= model.image_min && count <= model.image_max;
}
