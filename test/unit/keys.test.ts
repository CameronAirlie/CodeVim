import { describe, expect, it } from 'vitest';
import { textToNvimKeys } from '../../src/features/keys';
import { keyCombo, toNvimKey } from '../../src/webview/keys';

const key = (k: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe('toNvimKey', () => {
  it('passes printable characters through', () => {
    expect(toNvimKey(key('a'))).toBe('a');
    expect(toNvimKey(key('A', { shift: true }))).toBe('A');
    expect(toNvimKey(key('<'))).toBe('<lt>');
    expect(toNvimKey(key(' '))).toBe(' ');
  });

  it('encodes modifiers', () => {
    expect(toNvimKey(key('d', { ctrl: true }))).toBe('<C-d>');
    expect(toNvimKey(key('x', { alt: true }))).toBe('<M-x>');
    expect(toNvimKey(key('P', { ctrl: true, shift: true }))).toBe('<C-S-p>');
    expect(toNvimKey(key(' ', { ctrl: true }))).toBe('<C-Space>');
  });

  it('names special keys', () => {
    expect(toNvimKey(key('Enter'))).toBe('<CR>');
    expect(toNvimKey(key('Escape'))).toBe('<Esc>');
    expect(toNvimKey(key('Tab', { shift: true }))).toBe('<S-Tab>');
    expect(toNvimKey(key('ArrowUp', { ctrl: true }))).toBe('<C-Up>');
    expect(toNvimKey(key('F5'))).toBe('<F5>');
  });

  it('ignores modifier-only and dead keys', () => {
    expect(toNvimKey(key('Shift', { shift: true }))).toBeUndefined();
    expect(toNvimKey(key('Dead'))).toBeUndefined();
  });

  it('treats AltGr characters as plain text', () => {
    expect(toNvimKey(key('@', { ctrl: true, alt: true }))).toBe('@');
  });

  it('describes combos for passthrough', () => {
    expect(keyCombo(key('P', { ctrl: true, shift: true }))).toBe('ctrl+shift+p');
  });
});

describe('textToNvimKeys', () => {
  it('escapes < and newlines', () => {
    expect(textToNvimKeys('a<b\n')).toBe('a<lt>b<CR>');
  });
});
