import { describe, expect, it } from 'vitest';
import {
  allocateTicks,
  buildMaskingPlan,
  computeStrip,
  evaluate,
  formatSeconds,
  LIMITS,
  MASKING_PLAN_HEADER,
  roundHalfUp,
  toTabSeparatedPlan,
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

describe('allocateTicks（最大余额法分配 0.1 秒刻度）', () => {
  it('先向下取整，再按小数余量从大到小补发剩余刻度', () => {
    // ×10 后为 10.1 / 20.9：底分 10+20=30，总刻度 31，余量 0.9 的右侧段拿到唯一补发
    expect(allocateTicks([1.01, 2.09], 31)).toEqual([10, 21]);
    // ×10 后为 5.8 / 3.6 / 2.6：底分 5+3+2=10，总刻度 13，补发顺序为余量最大者
    expect(allocateTicks([0.58, 0.36, 0.26], 13)).toEqual([6, 4, 3]);
  });

  it('余量同分时左侧较早步骤优先', () => {
    // ×10 后均为 x.5：10.5 / 20.5 / 30.5，底分 60，总刻度 62，两枚补发归最左两段
    expect(allocateTicks([1.05, 2.05, 3.05], 62)).toEqual([11, 21, 30]);
    // 最大余量与同分混合：20.7 先得补发，余下一枚在两个 0.5 同分中归左侧
    expect(allocateTicks([1.05, 2.07, 3.05], 62)).toEqual([11, 21, 30]);
  });

  it('多段争夺剩余刻度时按余量排名逐个发放且总刻度守恒', () => {
    // 七段 ×10 后均为 1.4：底分 7，总刻度 10，三枚补发在同余门下归最左三段
    const ticks = allocateTicks([0.14, 0.14, 0.14, 0.14, 0.14, 0.14, 0.14], 10);
    expect(ticks).toEqual([2, 2, 2, 1, 1, 1, 1]);
    expect(ticks.reduce((sum, value) => sum + value, 0)).toBe(10);
  });
});

describe('buildMaskingPlan（累积遮挡操作单）', () => {
  it('默认参数生成 5.0/2.1/2.9/4.1/5.9，累计终点 20.0 秒', () => {
    const plan = buildMaskingPlan(validate(valid).values!);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error('应可形成操作单');
    expect(plan.totalTicks).toBe(200);
    expect(plan.totalLabel).toBe('20.0');
    expect(plan.steps.map((s) => s.segmentLabel)).toEqual([
      '5.0',
      '2.1',
      '2.9',
      '4.1',
      '5.9',
    ]);
    expect(plan.steps.map((s) => s.cumulativeLabel)).toEqual([
      '5.0',
      '7.1',
      '10.0',
      '14.1',
      '20.0',
    ]);
    // 各段刻度之和恒等于总刻度
    expect(plan.steps.reduce((sum, s) => sum + s.segmentTicks, 0)).toBe(plan.totalTicks);
    expect(plan.steps.at(-1)!.cumulativeTicks).toBe(plan.totalTicks);
  });

  it('增量与累计目标取自未四舍五入曝光，而非试条显示的一位小数', () => {
    // base=7、0→1 档 3 格：精确目标 7 / 9.89949… / 14，
    // 第二段增量 2.89949…（×10=28.995）余量 0.995 大于第三段的 0.005，
    // 唯一补发归第二段；若从显示值 7.0/9.9/14.0 反推则不会经过余量竞争。
    const plan = buildMaskingPlan({ base: 7, start: 0, end: 1, count: 3 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error('应可形成操作单');
    expect(plan.steps.map((s) => s.segmentTicks)).toEqual([70, 29, 41]);
    expect(plan.steps.map((s) => s.segmentLabel)).toEqual(['7.0', '2.9', '4.1']);
    expect(plan.steps.map((s) => s.cumulativeLabel)).toEqual(['7.0', '9.9', '14.0']);
  });

  it('多组合法参数下总刻度恒等于最高目标 ×10 四舍五入，且逐段守恒', () => {
    const cases = [
      { base: 10, start: 0, end: 2, count: 4 },
      { base: 3.3, start: -1.5, end: 2, count: 6 },
      { base: 300, start: -3, end: 3, count: 9 },
      { base: 0.3, start: -2, end: 1, count: 5 },
    ];
    for (const v of cases) {
      const plan = buildMaskingPlan(v);
      if (!plan.ok) throw new Error(`参数 ${JSON.stringify(v)} 不应出现 0 刻度段`);
      const expectedTotal = Math.round(
        Number(((v.base * 2 ** v.end) * 10).toPrecision(15)),
      );
      expect(plan.totalTicks).toBe(expectedTotal);
      const sum = plan.steps.reduce((acc, s) => acc + s.segmentTicks, 0);
      expect(sum).toBe(plan.totalTicks);
      plan.steps.forEach((s, i) => {
        expect(s.segmentTicks).toBeGreaterThan(0);
        expect(s.step).toBe(i + 1);
      });
    }
  });

  it('曝光区域依次为全纸与遮住左侧已完成格后的余下区域', () => {
    const plan = buildMaskingPlan(validate(valid).values!);
    if (!plan.ok) throw new Error('应合法');
    expect(plan.steps.map((s) => s.area)).toEqual([
      '全纸（不遮挡）',
      '遮住左侧已完成第 1 格，曝光余下 4 格',
      '遮住左侧已完成第 1～2 格，曝光余下 3 格',
      '遮住左侧已完成第 1～3 格，曝光余下 2 格',
      '遮住左侧已完成第 1～4 格，曝光余下 1 格',
    ]);
  });

  it('任一段分到 0 刻度时判定无法形成独立步骤，并指出步骤序号', () => {
    // base=0.1、-3→+3 档 7 格：目标 0.0125…0.8，前三段增量不足 0.05 秒，
    // 最大余额竞争后仍为 0 刻度
    const plan = buildMaskingPlan({ base: 0.1, start: -3, end: 3, count: 7 });
    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error('应出现 0 刻度段');
    expect(plan.steps).toBeNull();
    expect(plan.zeroTickSteps).toEqual([1, 2, 3]);
  });
});

describe('toTabSeparatedPlan（操作单复制内容）', () => {
  it('输出带步骤/曝光区域/本段秒数/累计秒数表头的制表符文本', () => {
    const plan = buildMaskingPlan(validate(valid).values!);
    if (!plan.ok) throw new Error('应合法');
    const text = toTabSeparatedPlan(plan.steps);
    const lines = text.split('\n');
    expect(lines[0].split('\t')).toEqual([...MASKING_PLAN_HEADER]);
    expect(lines).toHaveLength(6);
    expect(lines[1]).toBe('1\t全纸（不遮挡）\t5.0\t5.0');
    expect(lines[5]).toBe('5\t遮住左侧已完成第 1～4 格，曝光余下 1 格\t5.9\t20.0');
  });
});
