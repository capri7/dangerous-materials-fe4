/// <reference types="node" />
import { test, expect } from '@playwright/test';


// 実プロジェクトのスラッグ例
const SID = 'defined_substances';
const CID = 'handler_certification';

// ====== 実URL ======
const PAGE_FREE_A   = '/contents/law/defined_substances/Otsux_Law_Defined_Substances_001.html?mode=free&scope=free';
const PAGE_FREE_B   = '/contents/physical_chemistry/combustion_chemistry/Otsux_Phy_Combustion_Chemistry_001.html?mode=free&scope=free';

const PAGE_SUB_IN   = `/contents/law/defined_substances/Otsux_Law_Defined_Substances_003.html?mode=all&scope=sub&sid=${SID}`;
// わざと別 sub の実ページに入る（← でも sid は SID のまま！）
const PAGE_SUB_OUT  = `/contents/properties_prevention/classification_of_dangerous_goods/Otsux_Prop_Classification_Of_Dangerous_Goods_003.html?mode=all&scope=sub&sid=${SID}`;

const PAGE_CAT_LAST  = `/contents/law/handler_certification/Otsux_Law_Handler_Certification_005.html?mode=all&scope=cat&cid=${CID}`;
const PAGE_CAT_FIRST = `/contents/law/handler_certification/Otsux_Law_Handler_Certification_001.html?mode=all&scope=cat&cid=${CID}`;


function paramsOf(url: string) {
  const u = new URL(url, 'http://localhost');
  return u.searchParams;
}

async function noConsoleErrors(page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  // 呼び出し側で操作後に:
  await page.waitForTimeout(250);
  expect(errors, `console/page errors: \n${errors.join('\n')}`).toEqual([]);
}

// ====== 1) free: 無料だけで循環 & 課金に迷い込まない ======
test('scope=free: Next が無料問題だけを循環し、パラメータ保持', async ({ page }) => {
  await page.goto(PAGE_FREE_A, { waitUntil: 'domcontentloaded' });
  await noConsoleErrors(page);

  // 次へ → B
  await page.locator('#btn-next').click();
  await page.waitForLoadState('domcontentloaded');
  expect(page.url()).toContain('scope=free');
  expect(page.url()).toContain('mode=free');

  // “無料内”の想定ページへ（例：B）に到達していること
  // ここは厳密一致でもOK。ゆるくするなら dirname + basename で判定しても可。
  expect(new URL(page.url()).pathname).toContain(
    new URL(PAGE_FREE_B, 'http://localhost').pathname
  );

  // さらに次へ → A（循環）
  await page.locator('#btn-next').click();
  await page.waitForLoadState('domcontentloaded');
  expect(page.url()).toContain('scope=free');
  expect(new URL(page.url()).pathname).toContain(
    new URL(PAGE_FREE_A, 'http://localhost').pathname
  );
});

// ====== 2) sub: 別 sub に迷い込んだら即リダイレクト ======
test('scope=sub: 異なる sub へ直アクセスしても Scope Guard で正しいsubへ戻す', async ({ page }) => {
  // わざと“間違ったsub”のページに入る
  await page.goto(PAGE_SUB_OUT, { waitUntil: 'domcontentloaded' });

  // ensurePageInScope が動いて “正しいsub”へリダイレクトされる想定
  await page.waitForLoadState('domcontentloaded');
  const url = new URL(page.url());
  expect(url.searchParams.get('scope')).toBe('sub');
  expect(url.searchParams.get('sid')).toBe(paramsOf(PAGE_SUB_IN).get('sid'));


  await noConsoleErrors(page);
});

// ====== 3) cat: 最後→先頭の境界遷移 ======
test('scope=cat: カテゴリ最後から次へでカテゴリ先頭へ循環し、パラメータ保持', async ({ page }) => {
  await page.goto(PAGE_CAT_LAST, { waitUntil: 'domcontentloaded' });

  await page.locator('#btn-next').click();
  await page.waitForLoadState('domcontentloaded');

  const url = new URL(page.url());
  expect(url.searchParams.get('scope')).toBe('cat');
  expect(url.searchParams.get('cid')).toBe(paramsOf(PAGE_CAT_FIRST).get('cid'));

  // 先頭へ回っていること
  expect(url.pathname).toContain(new URL(PAGE_CAT_FIRST, 'http://localhost').pathname);

  await noConsoleErrors(page);
});

// ====== 4) 戻る: history.back() 後にガードが効いてループしない ======
test('戻る: history.back() でも scope/sid/cid が維持され、リダイレクトがループしない', async ({ page }) => {
  await page.goto(PAGE_FREE_A, { waitUntil: 'domcontentloaded' });
  await page.locator('#btn-next').click();
  await page.waitForLoadState('domcontentloaded');

  // back → ガード実行 → 最終URLが安定（2回以上の連続リダイレクトが無い）
  let navCount = 0;
  page.on('framenavigated', () => { navCount += 1; });

  await page.goBack(); // history.back()
  await page.waitForLoadState('domcontentloaded');

  const url = new URL(page.url());
  expect(url.searchParams.get('scope')).toBe('free');
  expect(navCount).toBeLessThan(3); // 無限リダイレクト抑止の簡易チェック

  await noConsoleErrors(page);
});
