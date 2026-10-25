/** Translates browser keyboard events into Neovim key notation (for nvim_input). */

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED: Record<string, string> = {
  Enter: 'CR',
  Escape: 'Esc',
  Backspace: 'BS',
  Tab: 'Tab',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Delete: 'Del',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
};

const IGNORED = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified', 'ContextMenu']);

const SPECIAL_CHARS: Record<string, string> = { ' ': 'Space', '<': 'lt', '\\': 'Bslash', '|': 'Bar' };

export function toNvimKey(e: KeyLike): string | undefined {
  if (IGNORED.has(e.key)) {
    return undefined;
  }
  const named = NAMED[e.key] ?? (/^F\d{1,2}$/.test(e.key) ? e.key : undefined);
  if (named) {
    let mods = '';
    if (e.ctrlKey) mods += 'C-';
    if (e.altKey) mods += 'M-';
    if (e.shiftKey) mods += 'S-';
    if (e.metaKey) mods += 'D-';
    return `<${mods}${named}>`;
  }
  if ([...e.key].length !== 1) {
    return undefined;
  }
  // Ctrl+Alt+<char> producing a printable character is AltGr on Windows/Linux layouts.
  if (e.ctrlKey && e.altKey && !/^[a-zA-Z]$/.test(e.key)) {
    return e.key === '<' ? '<lt>' : e.key;
  }
  let mods = '';
  if (e.ctrlKey) mods += 'C-';
  if (e.altKey) mods += 'M-';
  if (e.metaKey) mods += 'D-';
  if (!mods) {
    return e.key === '<' ? '<lt>' : e.key;
  }
  let ch = e.key;
  if (e.ctrlKey && e.shiftKey && /^[a-zA-Z]$/.test(ch)) {
    mods += 'S-';
    ch = ch.toLowerCase();
  }
  return `<${mods}${SPECIAL_CHARS[ch] ?? ch}>`;
}

/** "ctrl+shift+p" style description of an event, used for passthrough keys. */
export function keyCombo(e: KeyLike): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  if (e.metaKey) parts.push('meta');
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join('+');
}
