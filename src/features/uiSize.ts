import { Disposable, toDisposable } from '../core/disposable';
import { NvimSession } from '../nvim/session';

export interface Size {
  width: number;
  height: number;
}

/**
 * Arbitrates Neovim's UI (grid) size.
 *
 * Normally the grid matches the visible part of the active VS Code editor so that
 * scrolling commands (`<C-d>`, `zz`, `H`/`L`, 'scrolloff') behave like the editor
 * you see. While the Neovim surface is open it claims the size of its panel instead.
 */
export class UiSizeController {
  private base: Size;
  private claims: Size[] = [];

  constructor(private readonly session: NvimSession) {
    this.base = session.size;
  }

  setBase(size: Size): void {
    this.base = size;
    this.apply();
  }

  /** Overrides the size until the returned disposable is disposed. */
  claim(size: Size): Disposable & { update(size: Size): void } {
    const entry = { ...size };
    this.claims.push(entry);
    this.apply();
    const d = toDisposable(() => {
      this.claims = this.claims.filter((c) => c !== entry);
      this.apply();
    });
    return {
      dispose: () => d.dispose(),
      update: (s: Size) => {
        entry.width = s.width;
        entry.height = s.height;
        this.apply();
      },
    };
  }

  get isClaimed(): boolean {
    return this.claims.length > 0;
  }

  private apply(): void {
    const size = this.claims[this.claims.length - 1] ?? this.base;
    this.session.resize(size.width, size.height);
  }
}
