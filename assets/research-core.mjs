import {MODEL_REGISTRY,researchCapabilities} from './model-registry.mjs';
import {safeProvenance} from './conversation-export.mjs';

// These four public PNGs were read visually against the values below. Hashes lock the
// reference answers to the exact images; a changed PNG must be reviewed again.
export const SAMPLE_IMAGES=Object.freeze({
  a:Object.freeze({path:'./assets/samples/khu-vuc-a.png',sha256:'d42fa7a6fbd791ea0a00b4b0af59db43679961162578e9151aa1481347ae120e',months:[18,24,30],international:6,domestic:18}),
  b:Object.freeze({path:'./assets/samples/khu-vuc-b.png',sha256:'62bbb1f7cbcbbd81f910e99179036660e3a13d55abe127894d6a052b3502d7af',months:[14,17,23],international:4,domestic:13}),
  c:Object.freeze({path:'./assets/samples/khu-vuc-c.png',sha256:'cab2943885b06aa7e1655c7a7d55f3725e751ea1ba8e1fa5a8d7578a61bd2a8e',months:[21,28,25],international:9,domestic:19}),
  d:Object.freeze({path:'./assets/samples/khu-vuc-d.png',sha256:'315bb1cfd3a1c0087dfb0c9b92261e54eceb00dc79fa6bfde329d59aa3109bac',months:[11,16,20],international:4,domestic:12}),
});

export const SAMPLE_SCENARIOS=Object.freeze([
  {id:'chart-a-feb',category:'Đọc biểu đồ',title:'Đọc cột tháng 2',imageIds:['a'],question:'Khu vực A có bao nhiêu nghìn lượt khách trong tháng 2?',reference:String(SAMPLE_IMAGES.a.months[1])},
  {id:'chart-b-peak',category:'Đọc biểu đồ',title:'Xác định tháng cao nhất',imageIds:['b'],question:'Khu vực B có lượt khách cao nhất ở tháng nào?',reference:'Tháng 3'},
  {id:'math-a-quarter',category:'Tính toán',title:'Tổng ba tháng',imageIds:['a'],question:'Tổng lượt khách ba tháng của khu vực A là bao nhiêu nghìn lượt?',reference:String(SAMPLE_IMAGES.a.months.reduce((a,b)=>a+b,0))},
  {id:'math-a-parts',category:'Tính toán',title:'Cộng hai thành phần',imageIds:['a'],question:'Tổng khách quốc tế và nội địa tháng 2 của khu vực A là bao nhiêu nghìn lượt?',reference:String(SAMPLE_IMAGES.a.international+SAMPLE_IMAGES.a.domestic)},
  {id:'find-c-domestic',category:'Truy xuất thông tin',title:'Đọc ô nội địa',imageIds:['c'],question:'Khách nội địa tháng 2 của khu vực C là bao nhiêu nghìn lượt?',reference:String(SAMPLE_IMAGES.c.domestic)},
  {id:'find-d-international',category:'Truy xuất thông tin',title:'Đọc ô quốc tế',imageIds:['d'],question:'Khách quốc tế tháng 2 của khu vực D là bao nhiêu nghìn lượt?',reference:String(SAMPLE_IMAGES.d.international)},
  {id:'compare-ab',category:'So sánh nhiều ảnh',title:'So sánh hai khu vực',imageIds:['a','b'],question:'Tháng 2 khu vực A nhiều hơn khu vực B bao nhiêu nghìn lượt khách?',reference:String(SAMPLE_IMAGES.a.months[1]-SAMPLE_IMAGES.b.months[1])},
  {id:'compare-abcd',category:'So sánh nhiều ảnh',title:'Tổng bốn khu vực',imageIds:['a','b','c','d'],question:'Tổng lượt khách tháng 2 của cả bốn khu vực là bao nhiêu nghìn lượt?',reference:String(Object.values(SAMPLE_IMAGES).reduce((sum,item)=>sum+item.months[1],0))},
]);

export function compatibleModels(healthPayload,imageCount){return researchCapabilities(healthPayload,imageCount);}

export function validateResearchTrial(trial,images,models){
  const model=models.find(item=>item.model_id===trial.modelId);
  if(!model)return 'Model không khả dụng cho số ảnh hiện tại.';
  if(!MODEL_REGISTRY[model.model_id])return 'Model không có trong registry.';
  if(!model.max_new_tokens.includes(trial.maxNewTokens))return 'Giới hạn token chưa được Gateway công bố.';
  if(!Array.isArray(images)||images.length<model.image_min||images.length>model.image_max)return 'Số ảnh không phù hợp với model.';
  if(typeof trial.question!=='string'||!trial.question.trim()||trial.question.trim().length>1000)return 'Câu hỏi phải dài 1–1000 ký tự.';
  if(images.some(image=>!image.file||!['image/png','image/jpeg','image/webp'].includes(image.file.type)||image.file.size<=0||image.file.size>8*1024*1024||!/^[a-f0-9]{64}$/.test(image.sha256||'')))return 'Ảnh không hợp lệ hoặc chưa tính SHA-256.';
  if(images.reduce((total,image)=>total+image.file.size,0)>24*1024*1024)return 'Tổng dung lượng ảnh vượt 24 MB.';
  return null;
}

export function makeResearchForm(trial,images,turnstileToken){
  const model=MODEL_REGISTRY[trial.modelId];
  if(!model||typeof turnstileToken!=='string'||!turnstileToken)return null;
  const body=new FormData();
  body.append('model_id',trial.modelId);
  if(model.endpoint==='/infer-multi')images.forEach(image=>body.append('images',image.file,image.file.name));
  else body.append('image',images[0].file,images[0].file.name);
  body.append('question',trial.question.trim());
  body.append('turnstile',turnstileToken);
  if(trial.maxNewTokens!==32)body.append('max_new_tokens',String(trial.maxNewTokens));
  return {endpoint:model.endpoint,body};
}

export function checkedResult(payload,trial,imageCount){
  const provenance=payload?.provenance;
  const expectedMode=trial.modelId==='m7-7b-nb136'?'M7_MULTI_IMAGE_DEMO':trial.modelId==='s3-extended-4b'?'EXTENDED_DEMO':'SSRC_V04';
  if(payload?.status!=='INFERENCE_COMPLETED'||typeof payload.answer!=='string'||!provenance||
      provenance.verification_status!=='VERIFIED'||provenance.inference_mode!==expectedMode||
      (provenance.model_id!=null&&provenance.model_id!==trial.modelId)||
      provenance.max_new_tokens!==trial.maxNewTokens||provenance.requested_max_new_tokens!==trial.maxNewTokens||
      !Number.isInteger(provenance.output_tokens)||provenance.output_tokens<0||provenance.output_tokens>trial.maxNewTokens||
      (trial.modelId==='m7-7b-nb136'&&provenance.image_count!==imageCount))return null;
  return {answer:payload.answer,provenance:safeProvenance({...provenance,request_id:payload.request_id||provenance.request_id,client_recorded_at:new Date().toISOString()})};
}

export function comparisonType(trial,parent){
  if(!parent)return 'BASELINE';
  if(trial.modelId!==parent.modelId)return trial.question.trim()===parent.question.trim()?'DIFFERENT_BACKEND':'DIFFERENT_BACKEND_AND_QUESTION';
  const tokenChanged=trial.maxNewTokens!==parent.maxNewTokens;
  const questionChanged=trial.question.trim()!==parent.question.trim();
  if(tokenChanged&&questionChanged)return 'SAME_BACKEND_TOKEN_AND_QUESTION';
  if(tokenChanged)return 'SAME_BACKEND_TOKEN';
  if(questionChanged)return 'QUESTION_VARIANT';
  return 'SAME_CONFIGURATION';
}

export function comparisonLabel(type){
  return ({BASELINE:'Mốc so sánh',DIFFERENT_BACKEND:'Khác backend · không chỉ khác tokens',DIFFERENT_BACKEND_AND_QUESTION:'Khác backend và câu hỏi',SAME_BACKEND_TOKEN:'Cùng backend · khác token limit',SAME_BACKEND_TOKEN_AND_QUESTION:'Cùng backend · khác token và câu hỏi',QUESTION_VARIANT:'Cùng model · biến thể câu hỏi',SAME_CONFIGURATION:'Cùng cấu hình'})[type]||'Chưa phân loại';
}

function redact(value){return String(value??'').replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'[REDACTED]').replace(/\b(?:hf_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,})\b/g,'[REDACTED]').slice(0,4000);}
export function researchExport({scenarioId,images,trials},exportedAt=new Date().toISOString()){
  return {format:'vinfqa-research-workspace-v1',exported_at:exportedAt,scenario_id:scenarioId||null,
    images:images.map((image,index)=>({order:index+1,source:image.source||'uploaded',sha256:image.sha256,size_bytes:image.file?.size??null})),
    trials:trials.map(trial=>({id:trial.id,comparison_to_trial_id:trial.comparisonWith||null,comparison_type:comparisonType(trial,trials.find(item=>item.id===trial.comparisonWith)),model_id:trial.modelId,max_new_tokens:trial.maxNewTokens,question:redact(trial.question),reference_answer:redact(trial.reference),reference_source:trial.referenceSource||'USER_REVIEW_REQUIRED',answer:redact(trial.answer),status:trial.status,assessment:trial.assessment||'NOT_ASSESSED',notes:redact(trial.notes),started_at:trial.startedAt||null,completed_at:trial.completedAt||null,wall_seconds:trial.wallSeconds??null,http_status:trial.httpStatus??null,error_code:trial.errorCode||null,request_id:trial.requestId||null,provenance:safeProvenance(trial.provenance)})),
    limitations:{client_recorded_metadata_is_editable:true,reference_answers_locked_to_original_synthetic_images_and_question:true,includes_image_bytes:false,includes_credentials:false,no_automatic_quality_claim:true}};
}
const csvCell=value=>{const text=String(value??'');const safe=/^[=+\-@\t\r]/.test(text)?`'${text}`:text;return `"${safe.replaceAll('"','""')}"`;};
export function researchCsv(data){
  const columns=['id','comparison_to_trial_id','comparison_type','model_id','max_new_tokens','image_count','question','reference_answer','reference_source','answer','status','assessment','notes','wall_seconds','output_tokens','verification_status','request_id','http_status','error_code','image_sha256_ordered'];
  const rows=data.trials.map(trial=>({ ...trial,image_count:data.images.length,output_tokens:trial.provenance?.output_tokens,verification_status:trial.provenance?.verification_status,image_sha256_ordered:data.images.map(image=>image.sha256).join(';') }));
  return '\ufeff'+[columns.map(csvCell).join(','),...rows.map(row=>columns.map(column=>csvCell(row[column])).join(','))].join('\r\n');
}
export function researchMarkdown(data){
  const lines=['# VietInfographicQA · Research Workspace','',`Xuất lúc: ${data.exported_at}`,'','## Ảnh theo thứ tự',''];
  data.images.forEach(image=>lines.push(`${image.order}. SHA-256 ${image.sha256} · ${image.size_bytes??'NOT_VERIFIED'} bytes`));
  for(const trial of data.trials){
    lines.push('',`## Lượt ${trial.id}`,'',`- So với lượt: ${trial.comparison_to_trial_id??'mốc'} · ${comparisonLabel(trial.comparison_type)}`,`- Model: ${trial.model_id} · ${trial.max_new_tokens} tokens`,`- Trạng thái: ${trial.status} · đánh giá: ${trial.assessment}`,`- Câu hỏi: ${trial.question.replaceAll('\n',' ')}`,`- Tham chiếu: ${trial.reference_answer.replaceAll('\n',' ')} (${trial.reference_source})`,`- Trả lời: ${trial.answer.replaceAll('\n',' ')}`,`- Ghi chú: ${trial.notes.replaceAll('\n',' ')}`,`- Độ trễ: ${trial.wall_seconds??'NOT_VERIFIED'} s · HTTP ${trial.http_status??'NOT_VERIFIED'} · lỗi ${trial.error_code??'không có'}`,`- Request ID: ${trial.request_id??'NOT_VERIFIED'}`,`- Provenance: ${JSON.stringify(trial.provenance??{})}`);
  }
  lines.push('','_Bản xuất do trình duyệt tạo; metadata có thể bị sửa. Ảnh và credential không được đính kèm. Đây không phải đánh giá benchmark._');
  return lines.join('\n');
}
