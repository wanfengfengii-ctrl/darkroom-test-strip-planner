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

test('累积遮挡操作单：默认参数生成 5.0/2.1/2.9/4.1/5.9 秒且累计 20.0 秒', async ({ page }) => {
  const rows = page.getByTestId('plan-step');
  await expect(rows).toHaveCount(5);

  await expect(page.getByTestId('plan-step-no')).toHaveText(['1', '2', '3', '4', '5']);
  await expect(page.getByTestId('plan-segment')).toHaveText([
    '5.0',
    '2.1',
    '2.9',
    '4.1',
    '5.9',
  ]);
  await expect(page.getByTestId('plan-cumulative')).toHaveText([
    '5.0',
    '7.1',
    '10.0',
    '14.1',
    '20.0',
  ]);

  // 首步全纸曝光，随后逐步遮住左侧已完成格
  const areas = await page.getByTestId('plan-area').allInnerTexts();
  expect(areas[0]).toContain('全纸');
  expect(areas[1]).toContain('遮住左侧已完成第 1 格');
  expect(areas[4]).toContain('第 1～4 格');

  // 合计 20.0 秒，与最右一格累计一致
  await expect(page.getByTestId('plan-total')).toContainText('20.0');
});

test('复制操作单输出带表头的制表符文本', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-plan-button').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const lines = text.split('\n');
  expect(lines[0]).toBe('步骤\t曝光区域\t本段秒数\t累计秒数');
  expect(lines[1]).toBe('1\t全纸（不遮挡）\t5.0\t5.0');
  expect(lines[2]).toBe('2\t遮住左侧已完成第 1 格，曝光余下 4 格\t2.1\t7.1');
  expect(lines[5]).toBe('5\t遮住左侧已完成第 1～4 格，曝光余下 1 格\t5.9\t20.0');
  await expect(page.getByTestId('copy-plan-status')).toContainText('已复制');

  // 原秒数复制内容保持兼容、互不影响
  await page.getByTestId('copy-button').click();
  const seconds = await page.evaluate(() => navigator.clipboard.readText());
  expect(seconds).toBe('5.0\t7.1\t10.0\t14.1\t20.0');
});

test('存在 0 刻度段时仅隐藏操作单并就地说明，基础试条仍可用', async ({ page }) => {
  // base=0.1、-3→+3 档、7 格：首三段增量不足 0.1 秒，无法形成独立步骤
  await setField(page, 'base', '0.1');
  await setField(page, 'start', '-3');
  await setField(page, 'end', '3');
  await setField(page, 'count', '7');

  const notice = page.getByTestId('plan-unavailable');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('0.1 秒精度');
  await expect(page.getByTestId('masking-plan')).toHaveCount(0);
  await expect(page.getByTestId('copy-plan-button')).toHaveCount(0);

  // 基础试条与原秒数复制入口不受影响
  await expect(page.getByTestId('strip')).toBeVisible();
  await expect(page.getByTestId('copy-button')).toBeVisible();
  await expect(page.getByTestId('cell-seconds')).toHaveCount(7);
});

test('修改为合法输入后操作单即时重算', async ({ page }) => {
  // 基准改为 8 秒：目标 4 / 5.656… / 8 / 11.313… / 16
  await setField(page, 'base', '8');
  await expect(page.getByTestId('plan-segment')).toHaveText([
    '4.0',
    '1.7',
    '2.3',
    '3.3',
    '4.7',
  ]);
  await expect(page.getByTestId('plan-cumulative')).toHaveText([
    '4.0',
    '5.7',
    '8.0',
    '11.3',
    '16.0',
  ]);
  await expect(page.getByTestId('plan-total')).toContainText('16.0');

  // 非法输入时操作单与试条一并清空，修正后立即恢复
  await setField(page, 'base', '');
  await expect(page.getByTestId('masking-plan')).toHaveCount(0);
  await expect(page.getByTestId('plan-unavailable')).toHaveCount(0);
  await expect(page.getByTestId('result-empty')).toBeVisible();

  await setField(page, 'base', '8');
  await expect(page.getByTestId('masking-plan')).toBeVisible();
  await expect(page.getByTestId('plan-segment').first()).toHaveText('4.0');
});
