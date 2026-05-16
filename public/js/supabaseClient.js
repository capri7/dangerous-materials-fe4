// /js/supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';




export const SUPABASE_URL = 'https://vyzkkkskmwyctznbczzr.supabase.co'; 

export const supabase = createClient(
  SUPABASE_URL,
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5emtra3NrbXd5Y3R6bmJjenpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4NzUxNzEsImV4cCI6MjA2NTQ1MTE3MX0.OXCQww5s83c4y1KFN_60Bo7aftKDiXfOT6hQsoGcJ2w'
);


// デバッグ用（window.supabase に公開）
if (typeof window !== 'undefined' && !('supabase' in window)) {
  window.supabase = supabase;
}

// ここから下は2025/11/05に追加==== 画像URLヘルパー ====
// バケット名は「phy」。DBの image は「electricity_and_batteries/...svg」などの相対パス前提。

const BUCKET = 'phy';

/** Publicバケット向け：APIコールなしで即URL化（高速・安定） */
export function publicImageUrl(relativePath) {
  if (!relativePath) return null;
  // 先頭に "phy/" を入れないこと（DB値は相対パスに統一）
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${relativePath}`;
}

/** Private運用に切り替える時用：期限付きURLを発行 */
export async function signedImageUrl(relativePath, expiresSec = 3600) {
  if (!relativePath) return null;
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUrl(relativePath, expiresSec);
  if (error) {
    console.warn('signedImageUrl error:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}
