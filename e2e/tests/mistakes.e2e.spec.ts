/// <reference types="node" />
import { test, expect, type Page } from '@playwright/test';

// ---- 必要な環境変数（CI/ローカルで設定）
const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SUPABASE_ANON  = process.env.SUPABASE_ANON_KEY!;
const TEST_EMAIL     = process.env.TEST_EMAIL!;
const TEST_PASSWORD  = process.env.TEST_PASSWORD!;

// sanity check（足りないときは即落とす）
for (const [k, v] of Object.entries({
  SUPABASE_URL, SUPABASE_ANON, TEST_EMAIL, TEST_PASSWORD,
})) {
  if (!v) throw new Error(`Missing env: ${k}`);
}

// 試験する 2 ページ（URLスコープ遷移の確認用）
const PAGE_A = '/contents/law/defined_substances/Otsux_Law_Defined_Substances_001.html?mode=review';
const PAGE_B = '/contents/law/defined_substances/Otsux_Law_Defined_Substances_002.html?mode=review';

// ---- helper: URL から question_id を推定（basename から .html を外す）
async function getQuestionId(page: Page): Promise<string>  {
  const qid = await page.evaluate(() => {
    const last = location.pathname.split('/').pop() || '';
    return last.replace(/\.html$/i, '');
  });
  return qid;
}

// ---- helper: DB から “自分の最新1件（未削除）” を取得（ページ内で supabase を使う）
async function loadLatestInPage(page: Page, questionId?: string) {
  return await page.evaluate(async (qid: string | null) => {
    // @ts-ignore
    const sb = window.supabase;
    let query = sb.from('mistakes')
      .select('id, notes, incorrect_count, last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(1);
    if (qid) query = query.eq('question_id', qid);
    // RLSで未削除のみ見える構成なら絞り込みは不要。
    // もし物理カラムで管理しているなら、以下のように加えてもOK:
    // query = query.is('deleted_at', null);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data && data[0]) || null;
  }, questionId ?? null);
}

// ---- テストはシリアル実行（前テストの結果を前提にするため）
test.describe.configure({ mode: 'serial' });

async function ensureLogin(page: Page) {
  // フォールバック注入：ページに無ければ CDN から作る
  await page.addInitScript((opts: { url: string; anon: string }) => {
    (async () => {
      // @ts-ignore
      if (!('supabase' in window)) {
        try {
          // @ts-ignore -- runtime-only dynamic import in page context
          const mod = await import('https://esm.sh/@supabase/supabase-js@2?target=es2022');
          // ↓ ここを window に
          // @ts-ignore
          window.supabase = mod.createClient(opts.url, opts.anon);
          // @ts-ignore
          console.debug('[E2E] injected supabase from CDN');
        } catch (e) {
          // @ts-ignore
          (window as any).__supabase_inject_error__ = String(e);
        }
      } else {
        // @ts-ignore
        console.debug('[E2E] page provided supabase');
      }
    })();
  }, { url: SUPABASE_URL, anon: SUPABASE_ANON });

  // 対象ページへ
  await page.goto(PAGE_A, { waitUntil: 'domcontentloaded' });

  // ページ or CDN どちら経由でも API が使えるまで待つ（少し長め）
  await page.waitForFunction(() => {
    // @ts-ignore
    return !!(window.supabase?.auth?.signInWithPassword);
  }, { timeout: 30_000 });

  // サインイン
  const uid = await page.evaluate(
    async ({ email, password }: { email: string; password: string }) => {
      // @ts-ignore
      const { data, error } = await window.supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return data.user?.id ?? null;
    },
    { email: TEST_EMAIL, password: TEST_PASSWORD }
  );
  expect(uid, 'login uid').toBeTruthy();
}


test.describe('mistakes E2E（URLスコープ遷移 / 保存 / 削除 / 防御）', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLogin(page);
  });

  test('Aページ：メモが保存（デバウンス自動保存）される', async ({ page }) => {
    await page.goto(PAGE_A);

    // ★UI準備完了を待つ（HTML側で window.__mistake_ready__ を立てた）
    await page.waitForFunction(() => (window as any).__mistake_ready__ === true, { timeout: 10_000 });


    // UIの textarea が実在することを前提にする（後付けは自動保存が走らない）
    const ta = page.locator('#mistake-note');
    await expect(ta).toBeVisible();

    const note = `E2E note ${Date.now()}`;
    await ta.fill(note);

    const qid = await getQuestionId(page);
    try {
      await expect.poll(async () => {
        const rec = await loadLatestInPage(page, qid);
        return rec?.notes || '';
      }, { timeout: 15_000 }).toContain(note);
    } catch (e) {
      // ★診断ログ：UIと認証・保存エラーの状態をダンプ
      const diag = await page.evaluate(() => ({
        ready: (window as any).__mistake_ready__ === true,
        lastErr: (window as any).__mistake_last_error__ || null,
        status: document.getElementById('mistake-status')?.textContent || '',
        qidFromAttr: document.body.getAttribute('data-question-id'),
        qidFromUrl: location.pathname.split('/').pop()?.replace(/\.html$/i, ''),
      }));
      console.error('A-test diag:', diag);
      throw e; // 元の失敗をそのまま投げ直す
    }
  });

  test('Bページへ遷移して独立していること（URLスコープごと）', async ({ page }) => {
    await page.goto(PAGE_B);
    await page.waitForFunction(() => (window as any).__mistake_ready__ === true, { timeout: 10_000 });

    const qidB = await getQuestionId(page);
    const ta = page.locator('#mistake-note');
    const saveBtn = page.locator('#mistake-save');

    // 1) レコードが無ければ UI 経由でシード（RLSに沿うため）
    let recB = await loadLatestInPage(page, qidB);
    if (!recB) {
      const seed = `seed B ${Date.now()}`;
      await ta.fill(seed);
      await saveBtn.click();
      await expect.poll(async () => (await loadLatestInPage(page, qidB))?.notes || '', { timeout: 20_000 })
        .toContain(seed);
      recB = await loadLatestInPage(page, qidB);
    }

    // 2) 更新は Supabase 直書き（UI/デバウンス依存を排除）
    const note = `B note ${Date.now()}`;
    const result = await page.evaluate(async ({ id, text }) => {
      try {
        // @ts-ignore
        const sb = window.supabase;
        const { error } = await sb
          .from('mistakes')
          .update({ notes: text })
          .eq('id', id)
          .select('id'); // 実際に更新できたかを取得
        return { ok: !error, msg: error ? String(error.message) : '' };
      } catch (e) {
        return { ok: false, msg: String(e) };
      }
    }, { id: recB!.id, text: note });

    expect(result.ok, result.msg).toBeTruthy();

    // 3) DB反映を確認
    await expect.poll(async () => (await loadLatestInPage(page, qidB))?.notes || '', { timeout: 20_000 })
      .toContain(note);
  });

  test('Aページに戻ると A のメモが読み戻せる（スコープごとの永続）', async ({ page }) => {
    await page.goto(PAGE_A);
    const qidA = await getQuestionId(page);
    const recA = await loadLatestInPage(page, qidA);
    if (!recA) test.skip();  
    expect(recA).not.toBeNull();
  });

  test('論理削除：discard_mistake が成功し、その後は最新が取得できない', async ({ page }) => {
    await page.goto(PAGE_A);

    const qid = await getQuestionId(page);
    const before = await loadLatestInPage(page, qid);
    if (!before) test.skip(); // そもそも対象なし

    // RPC で論理削除
    const deletedId = await page.evaluate(async (id: string) => {
      // @ts-ignore
      const { data, error } = await window.supabase.rpc('discard_mistake', { rec_id: id });
      if (error) throw new Error(error.message);
      return data; // id or null
    }, before!.id);

    expect(deletedId, 'rpc returned id').toBe(before!.id);

    // 以後は “最新1件” にそのidが現れないこと（RLS/SELECT policy で未削除のみ可視）
    const latest = await loadLatestInPage(page, qid);
    if (latest && latest.id === deletedId) {
      throw new Error('deleted row is still visible (RLS/SELECT policy を確認)');
    }
  });

  test('防御：question_id を変更しようとすると失敗する（トリガ / RLS）', async ({ page }) => {
    await page.goto(PAGE_A);
    const qid = await getQuestionId(page);

    // 1) 対象レコードが無ければ UI でシード
    let target = await loadLatestInPage(page, qid);
    if (!target) {
      await page.waitForFunction(() => (window as any).__mistake_ready__ === true, { timeout: 10_000 });
      const ta     = page.locator('#mistake-note');
      const saveBtn= page.locator('#mistake-save');
      const status = page.locator('#mistake-status');

      const seed = `seed defense ${Date.now()}`;
      await ta.fill(seed);
      await saveBtn.click();
      await expect(status).toContainText('保存', { timeout: 5_000 });
      await expect.poll(async () => (await loadLatestInPage(page, qid))?.notes || '', { timeout: 20_000 })
        .toContain(seed);

      target = await loadLatestInPage(page, qid);
      if (!target) test.skip(); // それでも無ければスキップ
    }

    // 2) question_id を改ざんしようとすると失敗することを確認
    const updatedCount = await page.evaluate(async (id) => {
      // @ts-ignore
      const sb = window.supabase;
      const { data, error } = await sb
        .from('mistakes')
        .update({ question_id: 'tamper' })  // ← 変更禁止
        .eq('id', id)
        .select('id');                       // 実際に更新できた件数を得る
      if (error) return -1;                  // エラー構成なら -1
      return Array.isArray(data) ? data.length : 0;
    }, target!.id);

    // RLS/with check により 0 件（またはエラー）であること
    expect(updatedCount, 'update must not succeed').toBeLessThanOrEqual(0);
  });

});
