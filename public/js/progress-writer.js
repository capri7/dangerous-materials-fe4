// /public/js/progress-writer.js
import { supabase } from '/js/supabaseClient.js';

// UUID v4 を生成
function generateUuidV4() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = (globalThis.crypto?.getRandomValues)
    ? globalThis.crypto.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; // v4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const s = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

// マイページ即時反映用（任意）
function emitProgressRecorded(detail) {
  window.dispatchEvent(new CustomEvent('progress:recorded', { detail }));
}

// 進捗のみ保存（誤答カウントは question-main.js 側で実行）
export async function saveProgress({
  questionId,
  isCorrect,
  clientNonce,
  answeredAt = new Date(),
}) {
  const ts = (answeredAt instanceof Date)
    ? answeredAt.toISOString()
    : new Date(answeredAt).toISOString();
  const nonce = clientNonce || generateUuidV4();

  
  const { error } = await supabase.rpc('record_progress', {
  p_question_id: String(questionId),
  p_is_correct : !!isCorrect,
  p_answered_at: ts,
  p_client_nonce: nonce,
});
if (error) {
  console.error('[record_progress] error',
    { code: error.code, message: error.message, details: error.details, hint: error.hint }
  );
  throw error;
}


  emitProgressRecorded({ questionId, isCorrect, answeredAt: ts, clientNonce: nonce });
}
