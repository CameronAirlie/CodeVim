/**
 * Neovim `redraw` notifications are batches of `[name, args1, args2, ...]`.
 * They are flattened here into one entry per call, e.g.
 * `{ name: 'grid_line', args: [grid, row, col, cells, wrap] }`.
 */
export interface RedrawEvent {
  name: string;
  args: unknown[];
}

export function parseRedraw(params: unknown[]): RedrawEvent[] {
  const events: RedrawEvent[] = [];
  for (const batch of params) {
    if (!Array.isArray(batch) || typeof batch[0] !== 'string') {
      continue;
    }
    const name = batch[0];
    for (let i = 1; i < batch.length; i++) {
      events.push({ name, args: Array.isArray(batch[i]) ? (batch[i] as unknown[]) : [] });
    }
  }
  return events;
}

/** A chunk of styled text, as used by cmdline/messages: `[attr_id, text, hl_id?]`. */
export type Chunk = [number, string, number?];

export function chunksToText(chunks: unknown): string {
  if (!Array.isArray(chunks)) {
    return '';
  }
  return chunks.map((c) => (Array.isArray(c) ? String(c[1] ?? '') : '')).join('');
}

export function rgbToHex(color: number | undefined): string | undefined {
  if (color === undefined || color === null || color < 0) {
    return undefined;
  }
  return '#' + color.toString(16).padStart(6, '0');
}
