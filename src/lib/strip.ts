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
  | { ok: true; cells: StripCell[] }
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
  return { ok: true, cells: computeStrip(values) };
}

/** 按视觉顺序（从左到右）生成制表符分隔的秒数字符串。 */
export function toTabSeparatedSeconds(cells: StripCell[]): string {
  return cells.map((cell) => cell.secondsLabel).join('\t');
}
