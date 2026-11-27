export const UI_MODEL_IDS = Object.freeze({V04:'s3-v04-4b',EXTENDED:'s3-extended-4b',M7:'m7-7b-nb136'});

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
