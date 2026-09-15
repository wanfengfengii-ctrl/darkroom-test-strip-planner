/**
 * 试条计算核心逻辑（纯函数，无 DOM / 无网络依赖）。
 *
 * 档位即曝光值（EV）：每差 1 档，曝光时间相差 2 倍；半档相差 √2 ≈ 1.414 倍，
 * 而不是固定增减若干秒。
 */

export interface RawInputs {
  /** 基准曝光秒数（输入框原文） */
  base: string;
  /** 起始档位（输入框原文） */
  start: string;
  /** 结束档位（输入框原文） */
  end: string;
  /** 分格数（输入框原文） */
  count: string;
}

export interface ValidInputs {
  base: number;
  start: number;
  end: number;
  count: number;
}

export type FieldName = keyof RawInputs;
export type FieldErrors = Partial<Record<FieldName, string>>;

export interface StripCell {
  /** 从 1 开始的视觉序号（从左到右） */
  index: number;
  /** 该格档位原始计算值 */
  stop: number;
  /** 该格曝光秒数（四舍五入保留一位后的值） */
  seconds: number;
  /** 档位文本：两位小数 */
  stopLabel: string;
  /** 秒数文本：一位小数，保留尾随零 */
  secondsLabel: string;
}

export type Evaluation =
  | { ok: true; values: ValidInputs; cells: StripCell[] }
  | { ok: false; cells: null; errors: FieldErrors };

export const LIMITS = {
  base: { min: 0.1, max: 300.0 },
  stop: { min: -3.0, max: 3.0 },
  count: { min: 3, max: 9 },
} as const;

type ParseResult =
  | { kind: 'empty' }
  | { kind: 'non-finite' }
  | { kind: 'ok'; value: number };

function parseField(raw: string): ParseResult {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };
  const value = Number(text);
  // Number.isFinite 同时拦截 NaN（含 "abc"）、Infinity（含 "1e999"）
  return Number.isFinite(value) ? { kind: 'ok', value } : { kind: 'non-finite' };
}

/**
 * 十进制四舍五入到指定小数位（half-up）。
 *
 * 先把放大后的中间值修正到 15 位有效数字，消除 2.15 * 10 = 21.4999999…
 * 这类二进制浮点误差，再做 Math.round，保证“逢五进一”按十进制直觉生效。
 */
export function roundHalfUp(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`无法对非有限数做四舍五入：${String(value)}`);
  }
  const factor = 10 ** digits;
  const shifted = Number((value * factor).toPrecision(15));
  return Math.round(shifted) / factor;
}

/** 秒数统一格式：四舍五入保留一位小数并显示尾随零，如 14 → "14.0"。 */
export function formatSeconds(value: number): string {
  return roundHalfUp(value, 1).toFixed(1);
}

/** 档位统一格式：两位小数并显示尾随零，如 0.5 → "0.50"。 */
export function formatStop(value: number): string {
  return value.toFixed(2);
}

/** 校验四个字段，逐字段返回就地错误信息。 */
export function validate(raw: RawInputs): {
  values: ValidInputs | null;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const values: Partial<ValidInputs> = {};

  const base = parseField(raw.base);
  if (base.kind === 'empty') {
    errors.base = '请输入基准曝光秒数';
  } else if (base.kind === 'non-finite') {
    errors.base = '必须是有限数字';
  } else if (base.value < LIMITS.base.min || base.value > LIMITS.base.max) {
    errors.base = `需在 ${LIMITS.base.min}～${LIMITS.base.max.toFixed(1)} 秒之间`;
  } else {
    values.base = base.value;
  }

  const start = parseField(raw.start);
  if (start.kind === 'empty') {
    errors.start = '请输入起始档位';
  } else if (start.kind === 'non-finite') {
    errors.start = '必须是有限数字';
  } else if (start.value < LIMITS.stop.min || start.value > LIMITS.stop.max) {
    errors.start = `需在 ${LIMITS.stop.min.toFixed(1)}～+${LIMITS.stop.max.toFixed(1)} 之间`;
  } else {
    values.start = start.value;
  }

  const end = parseField(raw.end);
  if (end.kind === 'empty') {
    errors.end = '请输入结束档位';
  } else if (end.kind === 'non-finite') {
    errors.end = '必须是有限数字';
  } else if (end.value < LIMITS.stop.min || end.value > LIMITS.stop.max) {
    errors.end = `需在 ${LIMITS.stop.min.toFixed(1)}～+${LIMITS.stop.max.toFixed(1)} 之间`;
  } else {
    values.end = end.value;
  }

  const count = parseField(raw.count);
  if (count.kind === 'empty') {
    errors.count = '请输入分格数';
  } else if (count.kind === 'non-finite') {
    errors.count = '必须是有限数字';
  } else if (!Number.isInteger(count.value)) {
    errors.count = '必须是整数';
  } else if (count.value < LIMITS.count.min || count.value > LIMITS.count.max) {
    errors.count = `需为 ${LIMITS.count.min}～${LIMITS.count.max} 的整数`;
  } else {
    values.count = count.value;
  }

  // 跨字段约束：起始必须小于结束（挂在结束档位字段下就地提示）
  if (values.start !== undefined && values.end !== undefined && values.start >= values.end) {
    errors.end = `必须大于起始档位（当前起始 ${formatStop(values.start)}）`;
  }

  if (Object.keys(errors).length > 0) {
    return { values: null, errors };
  }
  return { values: values as ValidInputs, errors };
}

/**
 * 生成试条分格。
 *
 * 第 i 格档位：start + i × (end - start) / (N - 1)，i = 0 … N-1
 * 第 i 格秒数：base × 2^档位，结果四舍五入保留一位小数。
 */
export function computeStrip(v: ValidInputs): StripCell[] {
  const cells: StripCell[] = [];
  for (let i = 0; i < v.count; i += 1) {
    const stop = v.start + (i * (v.end - v.start)) / (v.count - 1);
    const secondsExact = v.base * 2 ** stop;
    const seconds = roundHalfUp(secondsExact, 1);
    cells.push({
      index: i + 1,
      stop,
      seconds,
      stopLabel: formatStop(stop),
      secondsLabel: seconds.toFixed(1),
    });
  }
  return cells;
}

/** 由输入原文一次性求值：任一字段非法即不产出任何分格。 */
export function evaluate(raw: RawInputs): Evaluation {
  const { values, errors } = validate(raw);
  if (values === null) {
    return { ok: false, cells: null, errors };
  }
  return { ok: true, values, cells: computeStrip(values) };
}

/** 按视觉顺序（从左到右）生成制表符分隔的秒数字符串。 */
export function toTabSeparatedSeconds(cells: StripCell[]): string {
  return cells.map((cell) => cell.secondsLabel).join('\t');
}

/** 各格的未四舍五入曝光目标（秒），供遮挡操作单累计换算，禁止从一位小数显示值反推。 */
export function exposureTargets(v: ValidInputs): number[] {
  const targets: number[] = [];
  for (let i = 0; i < v.count; i += 1) {
    const stop = v.start + (i * (v.end - v.start)) / (v.count - 1);
    targets.push(v.base * 2 ** stop);
  }
  return targets;
}

export interface MaskingStep {
  /** 步骤序号，从 1 开始（从左到右） */
  step: number;
  /** 本步骤的曝光区域描述（全纸 / 遮住左侧已完成格后的余下区域） */
  area: string;
  /** 本段分配到的 0.1 秒刻度数（整数） */
  segmentTicks: number;
  /** 本段秒数文本：刻度 / 10，保留一位小数 */
  segmentLabel: string;
  /** 完成本段后的累计 0.1 秒刻度数 */
  cumulativeTicks: number;
  /** 完成格累计时长文本：累计刻度 / 10，保留一位小数 */
  cumulativeLabel: string;
}

export type MaskingPlan =
  | { ok: true; steps: MaskingStep[]; totalTicks: number; totalLabel: string }
  | { ok: false; steps: null; zeroTickSteps: number[] };

/**
 * 最大余额法分配 0.1 秒刻度。
 *
 * 各段增量 ×10 后先一律向下取整，再把总刻度减去已分配刻度后的剩余刻度，
 * 按小数余量从大到小逐个发放；余量相同时左侧较早的步骤优先。
 *
 * @param increments 各段增量秒数（首段为第一格目标，后续为相邻目标之差）
 * @param totalTicks 总刻度 = 最高曝光目标 ×10 后十进制四舍五入
 */
export function allocateTicks(increments: number[], totalTicks: number): number[] {
  // toPrecision(15) 消除 20.9999999… 之类二进制尾差，保证向下取整与余量比较按十进制直觉进行
  const scaled = increments.map((inc) => Number((inc * 10).toPrecision(15)));
  const ticks = scaled.map((value) => Math.floor(value));
  const fractions = scaled.map((value, i) => value - ticks[i]);

  let remaining = totalTicks - ticks.reduce((sum, value) => sum + value, 0);
  const EPSILON = 1e-9;
  const order = fractions
    .map((_, i) => i)
    .sort((a, b) => {
      const diff = fractions[b] - fractions[a];
      if (Math.abs(diff) < EPSILON) return a - b; // 余量同分：左侧较早步骤优先
      return diff;
    });

  let cursor = 0;
  while (remaining > 0) {
    ticks[order[cursor % order.length]] += 1;
    cursor += 1;
    remaining -= 1;
  }
  return ticks;
}

/** 操作单表头（也是复制文本的首行）。 */
export const MASKING_PLAN_HEADER = ['步骤', '曝光区域', '本段秒数', '累计秒数'] as const;

/**
 * 以未四舍五入的各格曝光为累计目标，生成秒表逐段遮挡操作单。
 *
 * 首段增量取第一格目标，后续增量取相邻目标之差；增量 ×10 换算为 0.1 秒刻度，
 * 总刻度取最高目标 ×10 后十进制四舍五入。任一段分到 0 刻度即判定无法在
 * 0.1 秒精度形成独立步骤（此时仅操作单隐藏，基础试条不受影响）。
 */
export function buildMaskingPlan(v: ValidInputs): MaskingPlan {
  const targets = exposureTargets(v);
  const increments = targets.map((target, i) =>
    i === 0 ? target : target - targets[i - 1],
  );
  const totalTicks = roundHalfUp(targets[targets.length - 1] * 10, 0);
  const segmentTicks = allocateTicks(increments, totalTicks);

  const zeroTickSteps = segmentTicks
    .map((value, i) => (value === 0 ? i + 1 : null))
    .filter((value): value is number => value !== null);
  if (zeroTickSteps.length > 0) {
    return { ok: false, steps: null, zeroTickSteps };
  }

  let cumulativeTicks = 0;
  const steps: MaskingStep[] = segmentTicks.map((value, i) => {
    cumulativeTicks += value;
    let area: string;
    if (i === 0) {
      area = '全纸（不遮挡）';
    } else {
      const masked = i === 1 ? '第 1 格' : `第 1～${i} 格`;
      area = `遮住左侧已完成${masked}，曝光余下 ${v.count - i} 格`;
    }
    return {
      step: i + 1,
      area,
      segmentTicks: value,
      segmentLabel: (value / 10).toFixed(1),
      cumulativeTicks,
      cumulativeLabel: (cumulativeTicks / 10).toFixed(1),
    };
  });

  return {
    ok: true,
    steps,
    totalTicks,
    totalLabel: (totalTicks / 10).toFixed(1),
  };
}

/** 生成带表头的制表符遮挡操作单文本，可直接粘贴到电子表格。 */
export function toTabSeparatedPlan(steps: MaskingStep[]): string {
  const rows = steps.map((step) =>
    [step.step, step.area, step.segmentLabel, step.cumulativeLabel].join('\t'),
  );
  return [MASKING_PLAN_HEADER.join('\t'), ...rows].join('\n');
}
