/** Ctrl keys with a keybinding (names as in `codevim.ctrlKeys.*`); keep in sync with scripts/gen-keybindings.mjs. */
export const CTRL_KEYS = [...'abcdefghijklmnopqrstuvwxyz', ']', '6', '/', 'space', '['];

/**
 * Context key that gates `ctrl+<key>`. One boolean per key, because when clauses
 * cannot test a literal against a list (`'y' in list` does not parse).
 */
export function ctrlContextKey(key: string): string {
  const name = ({ ']': 'rbracket', '[': 'lbracket', '/': 'slash' } as Record<string, string>)[key] ?? key;
  return `codevim.ctrl.${name}`;
}

/** Escapes typed text for nvim_input (only `<` is special). */
export function textToNvimKeys(text: string): string {
  return text.replace(/</g, '<lt>').replace(/\r?\n/g, '<CR>');
}
