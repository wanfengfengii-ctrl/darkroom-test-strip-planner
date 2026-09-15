import { useMemo, useState, type CSSProperties } from 'react';
import {
  evaluate,
  LIMITS,
  toTabSeparatedSeconds,
  type FieldErrors,
  type FieldName,
  type RawInputs,
  type StripCell,
} from './lib/strip';

interface FieldConfig {
  name: FieldName;
  label: string;
  hint: string;
  placeholder: string;
  inputMode: 'decimal' | 'numeric';
}

const FIELDS: FieldConfig[] = [
  {
    name: 'base',
    label: '基准曝光秒数',
    hint: `范围 ${LIMITS.base.min}～${LIMITS.base.max.toFixed(1)} 秒；第 0 档实际使用的曝光时间`,
    placeholder: '例如 10.0',
    inputMode: 'decimal',
  },
  {
    name: 'start',
    label: '起始档位',
    hint: `范围 ${LIMITS.stop.min.toFixed(1)}～+${LIMITS.stop.max.toFixed(1)}；必须小于结束档位`,
    placeholder: '例如 -1.0',
    inputMode: 'decimal',
  },
  {
    name: 'end',
    label: '结束档位',
    hint: `范围 ${LIMITS.stop.min.toFixed(1)}～+${LIMITS.stop.max.toFixed(1)}；必须大于起始档位`,
    placeholder: '例如 +1.0',
    inputMode: 'decimal',
  },
  {
    name: 'count',
    label: '分格数',
    hint: `范围 ${LIMITS.count.min}～${LIMITS.count.max} 的整数；试条从左到右等宽分格`,
    placeholder: '例如 5',
    inputMode: 'numeric',
  },
];

// 初始示例值仅作为输入内容；试条始终由 evaluate() 实时计算，而非预置答案。
const INITIAL_INPUTS: RawInputs = {
  base: '10',
  start: '-1',
  end: '1',
  count: '5',
};

type CopyState =
  | { status: 'idle' }
  | { status: 'ok'; message: string }
  | { status: 'fail'; message: string };

function NumberField({
  config,
  value,
  error,
  onChange,
}: {
  config: FieldConfig;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const errorId = `error-${config.name}`;
  const hintId = `hint-${config.name}`;
  const invalid = error !== undefined;
  return (
    <div className="field">
      <label htmlFor={`field-${config.name}`}>{config.label}</label>
      <input
        id={`field-${config.name}`}
        data-testid={`input-${config.name}`}
        type="text"
        inputMode={config.inputMode}
        value={value}
        placeholder={config.placeholder}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <p className="field-error" id={errorId} data-testid={`error-${config.name}`} role="alert">
          {error}
        </p>
      ) : (
        <p className="field-hint" id={hintId} data-testid={`hint-${config.name}`}>
          {config.hint}
        </p>
      )}
    </div>
  );
}

/** 依据该格在整组试条中的相对曝光量，给出相纸灰度（0=黑，255=白）。 */
function cellGray(minStop: number, maxStop: number, stop: number): number {
  if (maxStop === minStop) return 128;
  const t = (stop - minStop) / (maxStop - minStop);
  // 高曝光端更黑：从 238（少曝光）线性过渡到 18（多曝光）
  return Math.round(238 - t * (238 - 18));
}

function StripView({ cells }: { cells: StripCell[] }) {
  const tabSeparated = toTabSeparatedSeconds(cells);
  const minStop = cells[0].stop;
  const maxStop = cells[cells.length - 1].stop;
  const [copyState, setCopyState] = useState<CopyState>({ status: 'idle' });

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tabSeparated);
      } else {
        // 非安全上下文（如局域网 http 访问）下的兜底路径
        const holder = document.createElement('textarea');
        holder.value = tabSeparated;
        holder.setAttribute('readonly', '');
        holder.style.position = 'fixed';
        holder.style.opacity = '0';
        document.body.appendChild(holder);
        holder.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(holder);
        if (!copied) throw new Error('execCommand copy returned false');
      }
      setCopyState({ status: 'ok', message: `已复制 ${cells.length} 个秒数（制表符分隔）` });
    } catch {
      setCopyState({
        status: 'fail',
        message: '复制失败：浏览器拒绝了剪贴板访问，请手动选择下方序列',
      });
    }
  }

  return (
    <section className="result" aria-live="polite">
      <div className="result-head">
        <h2>试条（从左到右曝光递增）</h2>
        <button
          type="button"
          className="copy-button"
          data-testid="copy-button"
          onClick={handleCopy}
        >
          复制秒数序列
        </button>
        <p
          className={`copy-status copy-status--${copyState.status}`}
          data-testid="copy-status"
          role="status"
        >
          {copyState.status === 'idle'
            ? '复制内容为按视觉顺序排列的制表符分隔秒数，可直接粘贴到表格'
            : copyState.message}
        </p>
      </div>

      <ol
        className="strip"
        data-testid="strip"
        aria-label="等宽曝光试条"
        style={{ '--cell-count': cells.length } as CSSProperties}
      >
        {cells.map((cell) => {
          const gray = cellGray(minStop, maxStop, cell.stop);
          const dark = gray < 128;
          return (
            <li
              key={cell.index}
              className={`strip-cell${dark ? ' strip-cell--dark' : ''}`}
              data-testid="strip-cell"
              data-cell-index={cell.index}
              style={{ backgroundColor: `rgb(${gray}, ${gray}, ${gray})` }}
            >
              <span className="cell-index" data-testid="cell-index">
                {cell.index}
              </span>
              <span className="cell-stop" data-testid="cell-stop">
                {cell.stopLabel}
              </span>
              <span className="cell-seconds" data-testid="cell-seconds">
                {cell.secondsLabel}
                <small>秒</small>
              </span>
            </li>
          );
        })}
      </ol>

      <output className="sequence" data-testid="seconds-sequence" aria-label="秒数序列">
        {tabSeparated}
      </output>
    </section>
  );
}

export default function App() {
  const [raw, setRaw] = useState<RawInputs>(INITIAL_INPUTS);
  const result = useMemo(() => evaluate(raw), [raw]);
  const errors: FieldErrors = result.ok ? {} : result.errors;

  return (
    <main className="page">
      <header className="page-header">
        <h1>暗房试条计算器</h1>
        <p className="subtitle">
          按档位等分曝光，而不是按固定秒数切分：半档的时间倍率是 √2 ≈ 1.414，不是“加半秒”。
        </p>
      </header>

      <form className="panel" onSubmit={(event) => event.preventDefault()}>
        <div className="fields">
          {FIELDS.map((config) => (
            <NumberField
              key={config.name}
              config={config}
              value={raw[config.name]}
              error={errors[config.name]}
              onChange={(value) => setRaw((prev) => ({ ...prev, [config.name]: value }))}
            />
          ))}
        </div>
        <p className="formula">
          第 i 格档位 = 起始 + i ×（结束 − 起始）/（N − 1）；曝光秒数 = 基准 × 2<sup>档位</sup>
          ，四舍五入保留一位小数。
        </p>
      </form>

      {result.ok ? (
        <StripView cells={result.cells} />
      ) : (
        <section className="result result--empty" data-testid="result-empty" aria-live="polite">
          <p>请修正上方标红的输入：所有字段合法后才会生成试条与秒数序列。</p>
        </section>
      )}

      <footer className="page-footer">
        所有计算均在本浏览器内完成，不调用任何外部服务；关闭或刷新页面后输入不会被上传。
      </footer>
    </main>
  );
}
