// Generates the `contributes.keybindings` section of package.json.
//
// Keybindings are data-driven: special keys are sent to Neovim whenever CodeVim
// "captures" keys (any mode except VS Code-typed insert mode); Ctrl keys are sent
// only when listed in the `codevim.ctrlKeys.*` setting for the current mode.
// Run `npm run gen:keybindings` after editing this file.
import { readFileSync, writeFileSync } from 'fs';

const ACTIVE = 'editorTextFocus && codevim.active';

const special = [
  ['backspace', '<BS>'],
  ['shift+backspace', '<S-BS>'],
  ['delete', '<Del>'],
  ['enter', '<CR>'],
  ['shift+enter', '<S-CR>'],
  ['tab', '<Tab>'],
  ['shift+tab', '<S-Tab>'],
  ['up', '<Up>'],
  ['down', '<Down>'],
  ['left', '<Left>'],
  ['right', '<Right>'],
  ['home', '<Home>'],
  ['end', '<End>'],
  ['pageup', '<PageUp>'],
  ['pagedown', '<PageDown>'],
];

const ctrl = [...'abcdefghijklmnopqrstuvwxyz'].map((c) => [c, c]);
ctrl.push([']', ']'], ['6', '^'], ['/', '/'], ['space', 'Space'], ['[', '[']);

// One boolean context key per Ctrl key (see ctrlContextKey in src/features/keys.ts):
// when clauses cannot test a literal against a list, and an unparsable clause is
// dropped, leaving the binding active everywhere.
const ctrlContext = (key) => `codevim.ctrl.${{ ']': 'rbracket', '[': 'lbracket', '/': 'slash' }[key] ?? key}`;

const keybindings = [
  {
    key: 'escape',
    command: 'codevim.escape',
    when: `${ACTIVE} && codevim.mode != 'normal'`,
  },
  {
    key: 'escape',
    command: 'codevim.escape',
    when: `${ACTIVE} && codevim.mode == 'normal' && !findWidgetVisible && !referenceSearchVisible && !markersNavigationVisible && !parameterHintsVisible && !suggestWidgetVisible && !inSnippetMode && !notificationToastsVisible && !renameInputVisible`,
  },
  ...special.map(([key, nvim]) => ({
    key,
    command: 'codevim.send',
    args: nvim,
    when: `${ACTIVE} && codevim.captureKeys`,
  })),
  ...ctrl.map(([key, nvim]) => ({
    key: `ctrl+${key}`,
    command: key === '[' ? 'codevim.escape' : 'codevim.send',
    ...(key === '[' ? {} : { args: `<C-${nvim}>` }),
    when: `${ACTIVE} && ${ctrlContext(key)}`,
  })),
  {
    key: 'ctrl+shift+alt+n',
    command: 'codevim.toggle',
  },
  // Go Back / Go Forward walk Neovim's jumplist (VS Code's default keys per platform).
  ...[
    ['codevim.jumpBack', { win: 'alt+left', linux: 'ctrl+alt+-', mac: 'ctrl+-' }],
    ['codevim.jumpForward', { win: 'alt+right', linux: 'ctrl+shift+-', mac: 'ctrl+shift+-' }],
  ].map(([command, keys]) => ({
    key: keys.win,
    ...keys,
    command,
    when: `${ACTIVE} && codevim.jumplist && codevim.mode == 'normal'`,
  })),
  // Undo / redo through Neovim's undo tree outside insert mode. A ctrl key given to
  // Neovim in `codevim.ctrlKeys` (e.g. ctrl+y to scroll) keeps that meaning.
  ...[
    ['codevim.undo', 'ctrl+z', 'cmd+z', `!${ctrlContext('z')}`],
    ['codevim.redo', 'ctrl+shift+z', 'cmd+shift+z', null],
    ['codevim.redo', 'ctrl+y', null, `!${ctrlContext('y')} && !isMac`],
  ].map(([command, key, mac, extra]) => ({
    key,
    ...(mac ? { mac } : {}),
    command,
    when: `${ACTIVE} && codevim.undo && codevim.mode != 'insert' && codevim.mode != 'replace' && codevim.mode != 'cmdline'${extra ? ` && ${extra}` : ''}`,
  })),
];

const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes = { ...pkg.contributes, keybindings };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`wrote ${keybindings.length} keybindings`);
