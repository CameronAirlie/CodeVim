import { Emitter } from './events';

export type ModeKind =
  | 'normal'
  | 'insert'
  | 'replace'
  | 'visual'
  | 'visualLine'
  | 'visualBlock'
  | 'select'
  | 'operator'
  | 'cmdline'
  | 'terminal';

export interface Mode {
  /** Raw mode string from `nvim_get_mode()` / ModeChanged, e.g. "n", "no", "niI", "V". */
  readonly raw: string;
  readonly kind: ModeKind;
  readonly isVisual: boolean;
  /** Insert or replace: text is being typed. */
  readonly isInsertLike: boolean;
}

const CTRL_V = '\x16';
const CTRL_S = '\x13';

export function parseMode(raw: string): Mode {
  const kind = classify(raw);
  return {
    raw,
    kind,
    isVisual: kind === 'visual' || kind === 'visualLine' || kind === 'visualBlock' || kind === 'select',
    isInsertLike: kind === 'insert' || kind === 'replace',
  };
}

function classify(raw: string): ModeKind {
  if (raw.startsWith('no')) {
    return 'operator';
  }
  switch (raw[0]) {
    case 'n':
      return 'normal'; // includes niI/niR/niV (i_CTRL-O) and nt
    case 'v':
      return 'visual';
    case 'V':
      return 'visualLine';
    case CTRL_V:
      return 'visualBlock';
    case 's':
    case 'S':
    case CTRL_S:
      return 'select';
    case 'i':
      return 'insert';
    case 'R':
      return 'replace';
    case 't':
      return 'terminal';
    case 'c':
    case 'r': // hit-enter / more / confirm prompts
    case '!':
      return 'cmdline';
    default:
      return 'normal';
  }
}

/** The authoritative Neovim mode as last reported by the runtime. */
export class ModeState {
  private currentMode = parseMode('n');
  private readonly changed = new Emitter<Mode>();
  readonly onDidChange = this.changed.event;

  get current(): Mode {
    return this.currentMode;
  }

  update(raw: string): void {
    if (raw === this.currentMode.raw) {
      return;
    }
    this.currentMode = parseMode(raw);
    this.changed.fire(this.currentMode);
  }

  dispose(): void {
    this.changed.dispose();
  }
}
