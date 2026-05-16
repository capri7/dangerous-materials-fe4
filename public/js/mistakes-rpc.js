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

/**
 * 正解した問題を「誤答リストから消す」ためのRPC呼び出し（まだ未使用）
 * - 後で question-main.js から呼び出す予定
 * - サーバ側に clear_mistake(p_question_id text) みたいな関数を作る前提
 */
export async function clearMistake(questionId) {
  if (!questionId) throw new Error('questionId is required');

  const params = { p_question_id: String(questionId) };

  const { data, error } = await supabase.rpc('clear_mistake', params);
  if (error) throw error;

  return data;
}