// public/js/basics.js
import { supabase } from './supabaseClient.js';


// 例: basics.js
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return;
  }
  // ログイン済みなら基礎知識コンテンツを初期化…
});
