import { parseMode } from '../core/mode';
import { CursorPayload } from '../nvim/protocol';
import { byteToUtf16, charLengthAt } from './positions';
import { Position } from './textDiff';

export interface PlainSelection {
  anchor: Position;
  active: Position;
}

function before(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

/**
 * Converts a Neovim cursor/visual state into VS Code selections.
 * Neovim visual selections are inclusive; VS Code's are end-exclusive.
 */
export function cursorToSelections(p: CursorPayload, lineAt: (line: number) => string, lineCount: number): PlainSelection[] {
  const clampLine = (l: number) => Math.max(0, Math.min(l, lineCount - 1));
  const pos = (line: number, byte: number): Position => {
    const l = clampLine(line);
    return { line: l, character: byteToUtf16(lineAt(l), byte) };
  };
  const after = (p: Position): Position => ({ line: p.line, character: p.character + charLengthAt(lineAt(p.line), p.character) });

  const cursor = pos(p.line, p.col);
  const mode = parseMode(p.mode);

  if (p.vline === undefined || p.vcol === undefined || !mode.isVisual) {
    return [{ anchor: cursor, active: cursor }];
  }
  const start = pos(p.vline, p.vcol);

  switch (mode.kind) {
    case 'visualLine': {
      if (cursor.line >= start.line) {
        return [{ anchor: { line: start.line, character: 0 }, active: { line: cursor.line, character: lineAt(cursor.line).length } }];
      }
      return [{ anchor: { line: start.line, character: lineAt(start.line).length }, active: { line: cursor.line, character: 0 } }];
    }
    case 'visualBlock': {
      if (p.block && p.block.length > 0) {
        const sels = p.block.map(([line, sb, eb]) => {
          const l = clampLine(line);
          const text = lineAt(l);
          return { anchor: { line: l, character: byteToUtf16(text, sb) }, active: { line: l, character: byteToUtf16(text, eb) } };
        });
        // The primary selection (first) is the one holding the cursor.
        const idx = sels.findIndex((s) => s.anchor.line === cursor.line);
        if (idx > 0) {
          sels.unshift(...sels.splice(idx, 1));
        }
        return sels;
      }
      return [{ anchor: start, active: after(cursor) }];
    }
    default: {
      if (before(cursor, start)) {
        return [{ anchor: after(start), active: cursor }];
      }
      return [{ anchor: start, active: after(cursor) }];
    }
  }
}

/** Cells of a visual block drawn past the end of one line (VS Code can't select there). */
export interface BlockOverhang {
  line: number;
  /** Blank cells between the end of the line and the block. */
  gap: number;
  /** Selected cells after the gap. */
  width: number;
  /** The cursor's cell, counted from the end of the line (0-based), if it is past it. */
  cursor?: number;
}

/** The parts of a blockwise visual selection that lie past the end of lines ('virtualedit'). */
export function blockOverhangs(p: CursorPayload): BlockOverhang[] {
  if (!p.block || parseMode(p.mode).kind !== 'visualBlock') return [];
  const out: BlockOverhang[] = [];
  for (const [line, , , gap = 0, pad = 0] of p.block) {
    if (pad <= 0) continue;
    const o: BlockOverhang = { line, gap, width: pad };
    if (line === p.line && p.past_eol) o.cursor = p.past_eol - 1;
    out.push(o);
  }
  return out;
}
