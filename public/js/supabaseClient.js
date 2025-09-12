// /js/supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://vyzkkkskmwyctznbczzr.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5emtra3NrbXd5Y3R6bmJjenpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4NzUxNzEsImV4cCI6MjA2NTQ1MTE3MX0.OXCQww5s83c4y1KFN_60Bo7aftKDiXfOT6hQsoGcJ2w'
);

// supabaseClient.js の末尾あたり
// 例: const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
if (typeof window !== 'undefined' && !('supabase' in window)) {
  window.supabase = supabase;
}
