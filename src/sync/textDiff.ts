/**
 * Computes the smallest single edit that turns one list of lines into another.
 *
 * Used to bring a VS Code document up to date with Neovim's buffer: Neovim changes
 * are applied to a mirror of the buffer, then the document is diffed against it.
 * This makes the sync idempotent (echoes produce no edit) and coalesces bursts of
 * Neovim changes into one VS Code edit.
 */

export interface Position {
  line: number;
  character: number;
}

export interface TextEdit {
  start: Position;
  end: Position;
  text: string;
}

export interface LineSource {
  readonly lineCount: number;
  lineAt(line: number): string;
}

export function arraySource(lines: readonly string[]): LineSource {
  return { lineCount: lines.length, lineAt: (i) => lines[i] };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function commonPrefix(a: string, b: string, max: number): number {
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i > 0 && i < Math.max(a.length, b.length) && isHighSurrogate(a.charCodeAt(i - 1))) i--;
  return i;
}

function commonSuffix(a: string, b: string, max: number): number {
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  // Don't split a surrogate pair: the char before the suffix must not be a high surrogate.
  if (i > 0 && isHighSurrogate(a.charCodeAt(a.length - i - 1))) i--;
  return i;
}

/** Returns the edit transforming `oldDoc` into `newLines`, or undefined if equal. */
export function computeEdit(oldDoc: LineSource, newLines: readonly string[]): TextEdit | undefined {
  const n = oldDoc.lineCount;
  const m = newLines.length;

  let top = 0;
  while (top < n && top < m && oldDoc.lineAt(top) === newLines[top]) top++;
  if (top === n && top === m) {
    return undefined;
  }
  let bottom = 0;
  while (bottom < n - top && bottom < m - top && oldDoc.lineAt(n - 1 - bottom) === newLines[m - 1 - bottom]) bottom++;

  const oldStart = top;
  const oldEnd = n - bottom; // exclusive
  const replacement = newLines.slice(top, m - bottom);

  // Pure line insertion.
  if (oldEnd === oldStart) {
    if (oldStart < n) {
      return { start: { line: oldStart, character: 0 }, end: { line: oldStart, character: 0 }, text: replacement.map((l) => l + '\n').join('') };
    }
    const last = oldDoc.lineAt(n - 1);
    const pos = { line: n - 1, character: last.length };
    return { start: pos, end: pos, text: '\n' + replacement.join('\n') };
  }

  // Pure line deletion.
  if (replacement.length === 0) {
    if (oldEnd < n) {
      return { start: { line: oldStart, character: 0 }, end: { line: oldEnd, character: 0 }, text: '' };
    }
    // Deleting through the last line: also remove the newline before the range.
    const prev = oldDoc.lineAt(oldStart - 1);
    const last = oldDoc.lineAt(n - 1);
    return { start: { line: oldStart - 1, character: prev.length }, end: { line: n - 1, character: last.length }, text: '' };
  }

  // Replacement: trim common characters at both ends to keep the edit minimal
  // (preserves VS Code cursors, decorations and diagnostics around the change).
  const firstOld = oldDoc.lineAt(oldStart);
  const lastOld = oldDoc.lineAt(oldEnd - 1);
  const firstNew = replacement[0];
  const lastNew = replacement[replacement.length - 1];
  const singleOld = oldEnd - oldStart === 1;
  const singleNew = replacement.length === 1;

  const prefix = commonPrefix(firstOld, firstNew, Math.min(firstOld.length, firstNew.length));
  let maxSuffix = Math.min(lastOld.length, lastNew.length);
  if (singleOld) maxSuffix = Math.min(maxSuffix, firstOld.length - prefix);
  if (singleNew) maxSuffix = Math.min(maxSuffix, firstNew.length - prefix);
  const suffix = commonSuffix(lastOld, lastNew, Math.max(0, maxSuffix));

  const middle = replacement.slice();
  if (singleNew) {
    middle[0] = firstNew.slice(prefix, firstNew.length - suffix);
  } else {
    middle[0] = firstNew.slice(prefix);
    middle[middle.length - 1] = lastNew.slice(0, lastNew.length - suffix);
  }
  return {
    start: { line: oldStart, character: prefix },
    end: { line: oldEnd - 1, character: lastOld.length - suffix },
    text: middle.join('\n'),
  };
}

/** Applies a lines event (`[first, last)` replaced by `lines`) to an array in place. */
export function applyLinesEvent(target: string[], first: number, last: number, lines: readonly string[]): void {
  const end = last < 0 ? target.length : last;
  if (lines.length < 10000) {
    target.splice(first, end - first, ...lines);
    return;
  }
  // Avoid spreading huge arrays into a call (argument count limits).
  const tail = target.slice(end);
  target.length = first;
  for (const l of lines) target.push(l);
  for (const l of tail) target.push(l);
}
