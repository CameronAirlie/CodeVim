/**
 * Column conversions. Neovim columns are UTF-8 byte offsets, VS Code columns are
 * UTF-16 code units. Each side converts using the text it owns.
 */

function utf8Width(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Byte offset → UTF-16 offset within `line` (clamped to the line length). */
export function byteToUtf16(line: string, byteCol: number): number {
  if (byteCol <= 0) {
    return 0;
  }
  let bytes = 0;
  let i = 0;
  while (i < line.length) {
    const cp = line.codePointAt(i)!;
    const width = utf8Width(cp);
    if (bytes + width > byteCol) {
      break;
    }
    bytes += width;
    i += cp > 0xffff ? 2 : 1;
    if (bytes === byteCol) {
      break;
    }
  }
  return i;
}

/** UTF-16 offset → byte offset within `line` (clamped to the line length). */
export function utf16ToByte(line: string, col: number): number {
  let bytes = 0;
  let i = 0;
  const end = Math.min(col, line.length);
  while (i < end) {
    const cp = line.codePointAt(i)!;
    bytes += utf8Width(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes;
}

/** UTF-16 length of the character starting at `col` (0 at end of line). */
export function charLengthAt(line: string, col: number): number {
  if (col >= line.length) {
    return 0;
  }
  const cp = line.codePointAt(col)!;
  return cp > 0xffff ? 2 : 1;
}
