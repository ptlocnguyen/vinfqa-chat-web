export const DEFAULT_MAX_NEW_TOKENS = 32;
export const ALLOWED_MAX_NEW_TOKENS = Object.freeze([32,64,128]);

export function supportedTokenLimits(healthPayload, extendedUiEnabled = false) {
  const advertised = healthPayload?.capabilities?.max_new_tokens;
  const extended = extendedUiEnabled && healthPayload?.capabilities?.extended_demo === true;
  if (!extended || !Array.isArray(advertised)) return [DEFAULT_MAX_NEW_TOKENS];
  const allowed = advertised.filter((value) => ALLOWED_MAX_NEW_TOKENS.includes(value));
  return ALLOWED_MAX_NEW_TOKENS.filter((value) => value === DEFAULT_MAX_NEW_TOKENS || allowed.includes(value));
}

export function provenancePresentation(metadata = {}) {
  const isExtended = metadata?.inference_mode === 'EXTENDED_DEMO';
  const isM7 = metadata?.inference_mode === 'M7_MULTI_IMAGE_DEMO';
  const isV04 = metadata?.inference_mode === 'SSRC_V04';
  const modeLabel = isM7 ? 'M7 Multi-image' : (isExtended ? 'Extended Demo' : (isV04 ? 'SSRC v04' : 'Mode NOT_VERIFIED'));
  const validLimit = (isM7 && metadata?.max_new_tokens === 96) ||
    (isExtended && [64,128].includes(metadata?.max_new_tokens)) ||
    (isV04 && metadata?.max_new_tokens === 32);
  const limit = validLimit
    ? metadata.max_new_tokens
    : null;
  const outputTokens = Number.isInteger(metadata?.output_tokens) && metadata.output_tokens >= 0 ? metadata.output_tokens : null;
  const requestedMatches = metadata?.requested_max_new_tokens == null || metadata.requested_max_new_tokens === limit;
  const verified = metadata?.verification_status === 'VERIFIED' && validLimit && outputTokens !== null && outputTokens <= limit && requestedMatches;
  const tokenBase = limit === null
    ? `${outputTokens ?? '—'} tokens · giới hạn NOT_VERIFIED`
    : `${outputTokens ?? '—'}/${limit} tokens`;
  const tokenLabel = !verified && !tokenBase.includes('NOT_VERIFIED') ? `${tokenBase} · NOT_VERIFIED` : tokenBase;
  const truncation = metadata?.possible_truncation === true
    ? `Có thể bị cắt ở ${limit ?? 'giới hạn chưa xác minh'} tokens`
    : (metadata?.possible_truncation === false ? '' : 'Trạng thái cắt: NOT_VERIFIED');
  return {isExtended,isM7,modeLabel,limit,outputTokens,verified,tokenLabel,truncation};
}

export function assistantModelLabel(modelId, metadata = {}) {
  if (metadata?.inference_mode === 'M7_MULTI_IMAGE_DEMO' || modelId === 'm7-7b-nb136') return 'M7 QLoRA 7B · Trợ lý multi-image';
  if (metadata?.inference_mode === 'EXTENDED_DEMO' || modelId === 's3-extended-4b') return 'Qwen3-VL-4B Extended · Trợ lý infographic';
  if (metadata?.inference_mode === 'SSRC_V04' || modelId === 's3-v04-4b') return 'SSRC v04 · Trợ lý infographic';
  return 'Trợ lý VietInfographicQA';
}

export function provenanceBranch(metadata = {}) {
  const value = metadata?.selected_branch || metadata?.route_predicted;
  return typeof value === 'string' && value.trim() ? value : null;
}
