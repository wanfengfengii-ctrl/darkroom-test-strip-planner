import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function setField(page: import('@playwright/test').Page, name: string, value: string) {
  await page.getByTestId(`input-${name}`).fill(value);
}

test('初始合法输入即生成等宽试条：半档为 1.414 倍附近', async ({ page }) => {
  const strip = page.getByTestId('strip');
  await expect(strip).toBeVisible();

  const cells = page.getByTestId('strip-cell');
  await expect(cells).toHaveCount(5);

  // 10s 基准、-1 到 +1 档、5 格 → 5.0 / 7.1 / 10.0 / 14.1 / 20.0
  await expect(page.getByTestId('cell-seconds').first()).toHaveText(/5\.0/);
  await expect(page.getByTestId('cell-seconds').nth(2)).toHaveText(/10\.0/);
  await expect(page.getByTestId('cell-seconds').nth(3)).toHaveText(/14\.1/);
  await expect(page.getByTestId('cell-seconds').last()).toHaveText(/20\.0/);

  // 档位两位小数、序号从 1 开始
  await expect(page.getByTestId('cell-stop')).toHaveText([
    '-1.00',
    '-0.50',
    '0.00',
    '0.50',
    '1.00',
  ]);
  await expect(page.getByTestId('cell-index')).toHaveText(['1', '2', '3', '4', '5']);

  // 每格等宽
  const widths = await cells.evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLElement).getBoundingClientRect().width),
  );
  const min = Math.min(...widths);
  const max = Math.max(...widths);
  expect(max - min).toBeLessThan(1);

  // 高曝光端（最右）颜色更深：亮度从左到右递减
  const backgrounds = await cells.evaluateAll((nodes) =>
    nodes.map((n) => getComputedStyle(n).backgroundColor),
  );
  const lum = (rgb: string) => {
    const m = rgb.match(/\d+(?:\.\d+)?/g)!;
    return Number(m[0]) + Number(m[1]) + Number(m[2]);
  };
  expect(lum(backgrounds[0])).toBeGreaterThan(lum(backgrounds[backgrounds.length - 1]));

  // 可视化序列与复制内容均为制表符分隔
  await expect(page.getByTestId('seconds-sequence')).toHaveText(
    '5.0\t7.1\t10.0\t14.1\t20.0',
  );

  // 半档倍率：14.1/10.0 ≈ 1.414，且不是等差（14.1-10 ≠ 20-14.1）
  expect(14.1 / 10).toBeCloseTo(Math.SQRT2, 2);
});

test('复制按钮输出制表符分隔秒数', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-button').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('5.0\t7.1\t10.0\t14.1\t20.0');
  await expect(page.getByTestId('copy-status')).toContainText('已复制');
});

test('任一非法或空输入立即清除旧序列与图形，并就地报错', async ({ page }) => {
  await expect(page.getByTestId('strip')).toBeVisible();

  // 清空基准秒数
  await setField(page, 'base', '');
  await expect(page.getByTestId('strip')).toHaveCount(0);
  await expect(page.getByTestId('seconds-sequence')).toHaveCount(0);
  await expect(page.getByTestId('copy-button')).toHaveCount(0);
  await expect(page.getByTestId('result-empty')).toBeVisible();
  await expect(page.getByTestId('error-base')).toBeVisible();

  // 修正后图形重新出现
  await setField(page, 'base', '8');
  await expect(page.getByTestId('strip')).toBeVisible();
  await expect(page.getByTestId('cell-seconds').nth(2)).toHaveText(/8\.0/);

  // 超范围
  await setField(page, 'base', '999');
  await expect(page.getByTestId('strip')).toHaveCount(0);
  await expect(page.getByTestId('error-base')).toContainText('秒');

  // 非有限数
  await setField(page, 'base', '1e999');
  await expect(page.getByTestId('error-base')).toContainText('有限数字');
  await expect(page.getByTestId('strip')).toHaveCount(0);

  // 非数字文本
  await setField(page, 'base', 'abc');
  await expect(page.getByTestId('error-base')).toContainText('有限数字');

  // 分格数非整数 / 超范围
  await setField(page, 'base', '10');
  await setField(page, 'count', '4.5');
  await expect(page.getByTestId('error-count')).toContainText('整数');
  await expect(page.getByTestId('strip')).toHaveCount(0);
  await setField(page, 'count', '12');
  await expect(page.getByTestId('error-count')).toBeVisible();
  await setField(page, 'count', '5');
  await expect(page.getByTestId('strip')).toBeVisible();

  // 起始不小于结束
  await setField(page, 'start', '2');
  await expect(page.getByTestId('error-end')).toContainText('大于起始档位');
  await expect(page.getByTestId('strip')).toHaveCount(0);
});

test('整档步长为精确 2 倍且尾随零保留', async ({ page }) => {
  await setField(page, 'base', '4');
  await setField(page, 'start', '0');
  await setField(page, 'end', '2');
  await setField(page, 'count', '3');
  await expect(page.getByTestId('cell-seconds')).toHaveText([/4\.0/, /8\.0/, /16\.0/]);
});
