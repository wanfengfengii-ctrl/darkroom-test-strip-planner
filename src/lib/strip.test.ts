import { describe, expect, it } from 'vitest';
import {
  computeStrip,
  evaluate,
  formatSeconds,
  LIMITS,
  roundHalfUp,
  toTabSeparatedSeconds,
  validate,
  type RawInputs,
} from './strip';

const valid: RawInputs = { base: '10', start: '-1', end: '1', count: '5' };

describe('roundHalfUp（十进制四舍五入）', () => {
  it('按十进制逢五进一，不受二进制浮点尾差影响', () => {
    expect(roundHalfUp(1.05, 1)).toBe(1.1);
    expect(roundHalfUp(2.15, 1)).toBe(2.2);
    expect(roundHalfUp(0.125, 2)).toBe(0.13);
    expect(roundHalfUp(14.142, 1)).toBe(14.1);
    expect(roundHalfUp(0.0125, 1)).toBe(0);
    expect(roundHalfUp(-0, 2)).toBe(0);
  });

  it('拒绝非有限数', () => {
    expect(() => roundHalfUp(Number.NaN, 1)).toThrow();
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY, 1)).toThrow();
  });
});

describe('formatSeconds（保留一位并显示尾随零）', () => {
  it('整数也补出一位小数零', () => {
    expect(formatSeconds(10)).toBe('10.0');
    expect(formatSeconds(2400)).toBe('2400.0');
    expect(formatSeconds(0.0125)).toBe('0.0');
  });
});

describe('computeStrip（档位与秒数序列）', () => {
  it('半档之间为 √2 ≈ 1.414 倍，而不是固定秒数差', () => {
    const cells = computeStrip({ base: 10, start: 0, end: 1, count: 3 });
    expect(cells.map((c) => c.secondsLabel)).toEqual(['10.0', '14.1', '20.0']);
    expect(cells[1].seconds / cells[0].seconds).toBeCloseTo(Math.SQRT2, 2);
    expect(cells[2].seconds / cells[1].seconds).toBeCloseTo(Math.SQRT2, 2);
    // 秒数差显然不相等：10→14.1 与 14.1→20
    expect(cells[1].seconds - cells[0].seconds).not.toBeCloseTo(
      cells[2].seconds - cells[1].seconds,
      1,
    );
  });

  it('按 start+i×(end−start)/(N−1) 等分，序号、两位小数档位、一位小数秒数齐全', () => {
    const cells = computeStrip(validate(valid).values!);
    expect(cells).toHaveLength(5);
    expect(cells.map((c) => c.index)).toEqual([1, 2, 3, 4, 5]);
    expect(cells.map((c) => c.stopLabel)).toEqual([
      '-1.00',
      '-0.50',
      '0.00',
      '0.50',
      '1.00',
    ]);
    expect(cells.map((c) => c.secondsLabel)).toEqual([
      '5.0',
      '7.1',
      '10.0',
      '14.1',
      '20.0',
    ]);
  });

  it('整档为 2 倍关系，且边界取值合法', () => {
    const cells = computeStrip({ base: 0.1, start: -3, end: 3, count: 7 });
    expect(cells[0].secondsLabel).toBe('0.0'); // 0.1 × 2^-3 = 0.0125
    expect(cells[6].secondsLabel).toBe('0.8'); // 0.1 × 2^3
    const up = computeStrip({ base: 300, start: 0, end: 3, count: 4 });
    expect(up.map((c) => c.secondsLabel)).toEqual([
      '300.0',
      '600.0',
      '1200.0',
      '2400.0',
    ]);
  });
});

describe('validate / evaluate（就地校验）', () => {
  it('合法输入返回值与空错误表', () => {
    const { values, errors } = validate(valid);
    expect(values).toEqual({ base: 10, start: -1, end: 1, count: 5 });
    expect(errors).toEqual({});
    expect(evaluate(valid).ok).toBe(true);
  });

  it('空值逐字段报错', () => {
    const result = evaluate({ base: '', start: '', end: '', count: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(Object.keys(result.errors).sort()).toEqual(['base', 'count', 'end', 'start']);
    expect(result.cells).toBeNull();
  });

  it('非数字与非有限数（abc、1e999）报错', () => {
    const r1 = evaluate({ ...valid, base: 'abc' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.base).toMatch(/有限数字/);

    const r2 = evaluate({ ...valid, start: '1e999' });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.start).toMatch(/有限数字/);

    const r3 = evaluate({ ...valid, count: 'NaN' });
    expect(r3.ok).toBe(false);
  });

  it('超范围取值报错（边界值本身合法）', () => {
    expect(evaluate({ ...valid, base: '0.05' }).ok).toBe(false);
    expect(evaluate({ ...valid, base: '300.1' }).ok).toBe(false);
    expect(evaluate({ ...valid, start: '-3.1' }).ok).toBe(false);
    expect(evaluate({ ...valid, end: '3.5' }).ok).toBe(false);
    expect(evaluate({ ...valid, count: '2' }).ok).toBe(false);
    expect(evaluate({ ...valid, count: '10' }).ok).toBe(false);

    const edge = evaluate({
      base: String(LIMITS.base.min),
      start: String(LIMITS.stop.min),
      end: String(LIMITS.stop.max),
      count: String(LIMITS.count.max),
    });
    expect(edge.ok).toBe(true);
  });

  it('分格数必须为整数', () => {
    const result = evaluate({ ...valid, count: '4.5' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.count).toMatch(/整数/);
  });

  it('起始档位必须小于结束档位', () => {
    const eq = evaluate({ ...valid, start: '0.5', end: '0.5' });
    expect(eq.ok).toBe(false);
    if (!eq.ok) expect(eq.errors.end).toMatch(/大于起始档位/);

    const gt = evaluate({ ...valid, start: '1', end: '0' });
    expect(gt.ok).toBe(false);
  });
});

describe('toTabSeparatedSeconds（复制内容）', () => {
  it('按视觉顺序输出制表符分隔秒数，保留一位小数', () => {
    const result = evaluate(valid);
    if (!result.ok) throw new Error('应合法');
    expect(toTabSeparatedSeconds(result.cells)).toBe('5.0\t7.1\t10.0\t14.1\t20.0');
  });
});
