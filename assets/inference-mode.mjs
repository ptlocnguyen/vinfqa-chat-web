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
  const modeLabel = isExtended ? 'Extended Demo' : 'SSRC v04';
  const limit = ALLOWED_MAX_NEW_TOKENS.includes(metadata?.max_new_tokens)
    ? metadata.max_new_tokens
    : (isExtended ? null : DEFAULT_MAX_NEW_TOKENS);
  const outputTokens = Number.isInteger(metadata?.output_tokens) ? metadata.output_tokens : null;
  const verified = metadata?.verification_status === 'VERIFIED' || (!isExtended && metadata?.verification_status == null);
  const tokenBase = limit === null
    ? `${outputTokens ?? '—'} tokens · giới hạn NOT_VERIFIED`
    : `${outputTokens ?? '—'}/${limit} tokens`;
  const tokenLabel = isExtended && !verified && limit !== null ? `${tokenBase} · NOT_VERIFIED` : tokenBase;
  const truncation = metadata?.possible_truncation === true
    ? `Có thể bị cắt ở ${limit ?? 'giới hạn chưa xác minh'} tokens`
    : (metadata?.possible_truncation === false ? '' : 'Trạng thái cắt: NOT_VERIFIED');
  return {isExtended,modeLabel,limit,outputTokens,verified,tokenLabel,truncation};
}
