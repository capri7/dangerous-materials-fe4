// public/js/mistakes-rpc.js
import { supabase } from '/js/supabaseClient.js';

export async function recordMistake(questionId, clientNonce) {
  if (!questionId) throw new Error('questionId is required');

  const params = { p_question_id: String(questionId) };
  if (clientNonce) params.p_client_nonce = String(clientNonce); // ← 重要

  const { data, error } = await supabase.rpc('record_mistake', params);
  if (error) throw error; // 認証切れ等はここで拾える

  return data; // 返り値は使わなくてもOK
}
