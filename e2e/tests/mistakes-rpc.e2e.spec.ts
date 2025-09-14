import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { test, expect } from '@playwright/test';
import { supabase } from '../../lib/supabase';

function newQid(): string {
  // Node 18+ なら randomUUID が使えます
  const uuid =
    (globalThis as any).crypto?.randomUUID?.() ??
    require('crypto').randomUUID();
  return 'UT_' + String(uuid).replace(/-/g, '');
}

test.describe('RPC record_mistake', () => {
  test('increments and keeps client_nonce', async () => {
    // 1) テストユーザーでログイン（auth.uid() を確定）
    const email = process.env.TEST_EMAIL!;
    const password = process.env.TEST_PASSWORD!;
    expect(email && password).toBeTruthy();

    const { data: auth, error: authError } =
      await supabase.auth.signInWithPassword({ email, password });
    expect(authError).toBeNull();
    expect(auth?.user).toBeTruthy();


    // 2) 未使用の question_id を生成（毎回ユニークなので事前掃除は不要）
    const qid = newQid();

    // 3) 1回目：新規作成 -> count=1
    const { data: r1, error: e1 } = await supabase.rpc('record_mistake', {
      p_question_id: qid,
    });
    expect(e1).toBeNull();
    expect(r1).toBeTruthy();
    expect(r1.incorrect_count).toBe(1);
    const nonce = r1.client_nonce;

    // 4) 2回目：加算更新 -> count=2（nonceは不変）
    const { data: r2, error: e2 } = await supabase.rpc('record_mistake', {
      p_question_id: qid,
    });
    expect(e2).toBeNull();
    expect(r1).toBeTruthy();
    expect(r2.incorrect_count).toBe(2);
    expect(r2.client_nonce).toBe(nonce);

    // （任意）後片付け：残骸を消したい場合だけ論理削除
    try {
      await supabase
        .from('mistakes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', auth.user!.id)
        .eq('question_id', qid)
        .is('deleted_at', null);
    } catch {
      // RLS 設計によっては update 不可でもスルーでOK（qidはユニークなので汚れません）
    }
  });
});
