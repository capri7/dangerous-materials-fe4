import { test, expect } from '@playwright/test';

// === あなたの実URLで置換 ===
const PAGE_FREE_A   = '/contents/law/defined_substances/Otsux_Law_Defined_Substances_001.html?mode=free&scope=free';
const PAGE_FREE_B   = '/contents/physical_chemistry/combustion_chemistry/Otsux_Phy_Combustion_Chemistry_001.html?mode=free&scope=free';
const PAGE_SUB_IN   = '/contents/law/defined_substances/Otsux_Law_Defined_Substances_003.html?mode=all&scope=sub&sid=SubA';
const PAGE_SUB_OUT  = '/contents/properties_prevention/classification_of_dangerous_goods/Otsux_Prop_Classification_Of_Dangerous_Goods_003.html?mode=all&scope=sub&sid=SubA';
const PAGE_CAT_LAST = '/contents/law/handler_certification/Otsux_Law_Handler_Certification_005.html?mode=all&scope=cat&cid=CatX';
const PAGE_CAT_FIRST= '/contents/law/handler_certification/Otsux_Law_Handler_Certification_001.html?mode=all&scope=cat&cid=CatX';

test.describe.configure({ mode: 'serial' });

function pathOf(u: string) {
  const url = new URL(u, 'http://dummy');
  return url.pathname;
}

test('free: 無料のみを循環し、クエリ維持', async ({ page }) => {
  const freePaths = [pathOf(PAGE_FREE_A), pathOf(PAGE_FREE_B)];
  await page.goto(PAGE_FREE_A);

  for (let i = 0; i < 4; i++) {
    await page.locator('#btn-next').click();
    await expect(page).toHaveURL(/[\?&]mode=free/);
    await expect(page).toHaveURL(/[\?&]scope=free/);

    const p = pathOf(page.url());
    expect(freePaths.includes(p), `free以外へ迷い込み: ${p}`).toBeTruthy();
  }
});

test('sub: 異なるsubへ行っても即ガードで戻る（sid維持）', async ({ page }) => {
  // subA 内のページから開始
  await page.goto(PAGE_SUB_IN);

  // 別subのURLに直で遷移 → ensurePageInScope が働いて subA 圏内へ戻す想定
  await page.goto(PAGE_SUB_OUT);
  await expect(page).toHaveURL(/[\?&]scope=sub/);
  await expect(page).toHaveURL(/[\?&]sid=SubA/);

  // 追加チェック: 連続で次へ押しても sid が消えない
  await page.locator('#btn-next').click();
  await expect(page).toHaveURL(/[\?&]sid=SubA/);
});

test('cat: 最後→先頭にラップし、cid維持', async ({ page }) => {
  await page.goto(PAGE_CAT_LAST);
  await page.locator('#btn-next').click();
  await expect(page).toHaveURL(new RegExp(pathOf(PAGE_CAT_FIRST).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await expect(page).toHaveURL(/[\?&]scope=cat/);
  await expect(page).toHaveURL(/[\?&]cid=CatX/);
});

test('戻る: history.back() 後もスコープガードでループしない', async ({ page }) => {
  await page.goto(PAGE_SUB_IN);
  await page.locator('#btn-next').click();
  const afterNext = page.url();

  await page.goBack(); // history.back()
  await expect(page).toHaveURL(/[\?&]scope=sub/);
  await expect(page).toHaveURL(/[\?&]sid=SubA/);

  // back→forwardでも無限ループしない
  await page.goForward();
  await expect(page).toHaveURL(afterNext);
});

