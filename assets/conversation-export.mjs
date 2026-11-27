const SAFE_PROVENANCE_KEYS = [
  'inference_mode','requested_max_new_tokens','max_new_tokens','output_tokens','route_predicted',
  'selected_branch','elapsed_seconds','possible_truncation','backend_revision','verification_status',
  'status','model_id','image_count','request_id','base_model_id','base_model_revision',
  'adapter_sha256','artifact_revision','input_tokens','error_code','http_status','timestamp','client_recorded_at',
];
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:hf_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,})\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

function redactText(value) {
  let text=String(value??'');
  for(const pattern of SECRET_PATTERNS)text=text.replace(pattern,'[REDACTED]');
  return text;
}

export function safeProvenance(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const result = {};
  for (const key of SAFE_PROVENANCE_KEYS) {
    if (Object.hasOwn(meta, key) && ['string','number','boolean'].includes(typeof meta[key])) result[key] = typeof meta[key]==='string'?redactText(meta[key]).slice(0,160):meta[key];
  }
  return result;
}

export function exportConversation(session, models, exportedAt = new Date().toISOString()) {
  const model = models.find((item) => item.model_id === session.modelId) || null;
  const images = Array.isArray(session.images) ? session.images : (session.file ? [{file:session.file}] : []);
  const provenanceImageCount = (session.messages || []).map((message)=>message.meta?.image_count).find(Number.isInteger);
  return {
    format: 'vinfqa-conversation-v1',
    exported_at: exportedAt,
    conversation: {
      title: redactText(session.title),
      model_id: model?.model_id ?? session.modelId ?? null,
      model_name: model?.label ?? null,
      image_count: images.length || (Number.isInteger(provenanceImageCount) ? provenanceImageCount : null),
      images: images.map((item,index) => ({order:index+1,size_bytes:item.file?.size ?? null})),
      messages: (session.messages || []).map((message) => ({
        role:message.role,
        text:redactText(message.text),
        created_at:message.createdAt ?? null,
        model_id:message.modelId ?? session.modelId ?? null,
        provenance:safeProvenance(message.meta),
      })),
    },
    privacy: {includes_image_bytes:false,includes_credentials:false,client_metadata_is_not_immutable_server_evidence:true},
  };
}

export function conversationMarkdown(data) {
  const conversation = data.conversation;
  const lines = [
    `# ${conversation.title || 'Cuộc trò chuyện VietInfographicQA'}`,'',
    `- Model: ${conversation.model_name || conversation.model_id || 'NOT_VERIFIED'}`,
    `- Số ảnh: ${conversation.image_count}`,
    ...conversation.images.map((image) => `- Ảnh ${image.order} (${image.size_bytes ?? 'NOT_VERIFIED'} bytes)`),
    '',
  ];
  for (const message of conversation.messages) {
    lines.push(`## ${message.role === 'assistant' ? 'Trợ lý' : 'Người dùng'}`,'',`Thời điểm: ${message.created_at || 'NOT_VERIFIED'}`,'',message.text || '', '');
    if (message.provenance) lines.push('```json',JSON.stringify(message.provenance,null,2),'```','');
  }
  lines.push(`_Xuất cục bộ lúc ${data.exported_at}. Ảnh và thông tin xác thực không được đính kèm._`);
  return lines.join('\n');
}
