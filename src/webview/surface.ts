/* Neovim surface: renders Neovim's screen grid and forwards input. Runs in a VS Code webview. */
import type { CmdlineState } from '../features/cmdlineState';
import type { CursorShape, HlStyle } from '../features/surface/grid';
import type { FromWebview, ToWebview } from '../features/surface/messages';
import { keyCombo, toNvimKey } from './keys';

declare function acquireVsCodeApi(): { postMessage(message: FromWebview): void };
declare global {
  interface Window {
    CODEVIM_SETTINGS: { font: string; size: number; passthrough: string[] };
  }
}

const vscode = acquireVsCodeApi();
const settings = window.CODEVIM_SETTINGS;
const passthrough = new Set(settings.passthrough.map((k) => k.toLowerCase().replace(/\s/g, '')));

const screen = document.getElementById('screen') as HTMLDivElement;
const style = document.createElement('style');
const hlStyle = document.createElement('style');
document.head.append(style, hlStyle);

const lineHeight = Math.ceil(settings.size * 1.35);
style.textContent = `
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body { background: var(--nvim-bg); }
  #screen { position: relative; outline: none; font-family: ${settings.font}; font-size: ${settings.size}px;
            line-height: ${lineHeight}px; white-space: pre; color: var(--nvim-fg); background: var(--nvim-bg);
            cursor: text; user-select: none; height: 100%; }
  .row { height: ${lineHeight}px; overflow: hidden; }
  #cursor { position: absolute; pointer-events: none; mix-blend-mode: difference; background: #fff; }
  #cmdline { position: absolute; left: 0; right: 0; bottom: 0; height: ${lineHeight}px; display: none;
             background: var(--nvim-bg); color: var(--nvim-fg); border-top: 1px solid var(--nvim-fg); }
  #cmdline .items { opacity: .7; }
  #cmdline .sel { text-decoration: underline; font-weight: bold; }
`;

const cursorEl = document.createElement('div');
cursorEl.id = 'cursor';
const cmdlineEl = document.createElement('div');
cmdlineEl.id = 'cmdline';
screen.append(cursorEl, cmdlineEl);

let rows: HTMLDivElement[] = [];
let cell = { width: 8, height: lineHeight };
let gridSize = { width: 0, height: 0 };
let cursor = { row: 0, col: 0 };
let shape: CursorShape = { shape: 'block', percentage: 100 };
let cmdlineVisible = false;
const highlights = new Map<number, HlStyle>();
let defaults = { fg: '#d4d4d4', bg: '#1e1e1e', sp: '#ff0000' };

function measure(): void {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(100);
  probe.style.visibility = 'hidden';
  screen.append(probe);
  cell = { width: probe.getBoundingClientRect().width / 100 || 8, height: lineHeight };
  probe.remove();
}

function css(id: number, h: HlStyle): string {
  let fg = h.fg ?? 'var(--nvim-fg)';
  let bg = h.bg ?? 'transparent';
  if (h.reverse) [fg, bg] = [h.bg ?? 'var(--nvim-bg)', h.fg ?? 'var(--nvim-fg)'];
  const decorations = [h.underline || h.undercurl ? 'underline' : '', h.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
  return `.h${id}{color:${fg};background:${bg};${h.bold ? 'font-weight:bold;' : ''}${h.italic ? 'font-style:italic;' : ''}${
    decorations ? `text-decoration:${decorations};` : ''
  }${h.undercurl ? `text-decoration-style:wavy;text-decoration-color:${h.sp ?? defaults.sp};` : ''}}`;
}

function renderHighlights(): void {
  hlStyle.textContent = [...highlights].map(([id, h]) => css(id, h)).join('\n');
  document.documentElement.style.setProperty('--nvim-fg', defaults.fg);
  document.documentElement.style.setProperty('--nvim-bg', defaults.bg);
}

function ensureRows(height: number): void {
  while (rows.length < height) {
    const row = document.createElement('div');
    row.className = 'row';
    screen.insertBefore(row, cursorEl);
    rows.push(row);
  }
  while (rows.length > height) rows.pop()!.remove();
}

function renderCursor(): void {
  if (cmdlineVisible) {
    cursorEl.style.display = 'none';
    return;
  }
  cursorEl.style.display = 'block';
  const x = cursor.col * cell.width;
  const y = cursor.row * cell.height;
  const pct = Math.max(10, shape.percentage) / 100;
  if (shape.shape === 'vertical') {
    Object.assign(cursorEl.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(2, cell.width * pct)}px`, height: `${cell.height}px` });
  } else if (shape.shape === 'horizontal') {
    const h = Math.max(2, cell.height * pct);
    Object.assign(cursorEl.style, { left: `${x}px`, top: `${y + cell.height - h}px`, width: `${cell.width}px`, height: `${h}px` });
  } else {
    Object.assign(cursorEl.style, { left: `${x}px`, top: `${y}px`, width: `${cell.width}px`, height: `${cell.height}px` });
  }
}

function renderCmdline(s: CmdlineState): void {
  cmdlineVisible = s.visible;
  cmdlineEl.style.display = s.visible ? 'block' : 'none';
  cmdlineEl.textContent = '';
  if (s.visible) {
    const before = document.createTextNode(`${s.firstc}${s.prompt}${' '.repeat(s.indent)}${s.content.slice(0, s.pos)}`);
    const caret = document.createElement('span');
    caret.textContent = s.content.slice(s.pos, s.pos + 1) || ' ';
    caret.style.cssText = 'background: var(--nvim-fg); color: var(--nvim-bg);';
    const after = document.createTextNode(s.content.slice(s.pos + 1));
    cmdlineEl.append(before, caret, after);
    if (s.items.length > 0) {
      const items = document.createElement('span');
      items.className = 'items';
      items.textContent = '   ';
      s.items.slice(0, 30).forEach((it, i) => {
        const span = document.createElement('span');
        span.textContent = it + ' ';
        if (i === s.selected) span.className = 'sel';
        items.append(span);
      });
      cmdlineEl.append(items);
    }
  }
  renderCursor();
}

function onFrame(m: Extract<ToWebview, { type: 'frame' }>): void {
  if (m.reset) highlights.clear();
  for (const [id, h] of Object.entries(m.highlights)) highlights.set(Number(id), h);
  defaults = m.defaults;
  if (m.reset || Object.keys(m.highlights).length > 0) renderHighlights();
  gridSize = { width: m.width, height: m.height };
  ensureRows(m.height);
  for (const { row, runs } of m.rows) {
    const el = rows[row];
    if (!el) continue;
    const frag = document.createDocumentFragment();
    for (const [text, hl] of runs) {
      const span = document.createElement('span');
      span.className = `h${hl}`;
      span.textContent = text;
      frag.append(span);
    }
    el.replaceChildren(frag);
  }
  cursor = m.cursor;
  shape = m.cursorShape;
  renderCursor();
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m.type === 'frame') onFrame(m);
  else if (m.type === 'cmdline') renderCmdline(m.state);
  else if (m.type === 'focus') screen.focus();
});

// Input ----------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (passthrough.has(keyCombo(e))) return; // let VS Code handle it
  const keys = toNvimKey(e);
  if (!keys) return;
  e.preventDefault();
  e.stopPropagation();
  vscode.postMessage({ type: 'input', keys });
});

function cellAt(e: MouseEvent): { row: number; col: number } {
  const rect = screen.getBoundingClientRect();
  return {
    row: Math.max(0, Math.min(gridSize.height - 1, Math.floor((e.clientY - rect.top) / cell.height))),
    col: Math.max(0, Math.min(gridSize.width - 1, Math.floor((e.clientX - rect.left) / cell.width))),
  };
}

function modifiers(e: MouseEvent | WheelEvent): string {
  return `${e.ctrlKey ? 'C' : ''}${e.shiftKey ? 'S' : ''}${e.altKey ? 'A' : ''}`;
}

const BUTTONS = ['left', 'middle', 'right'];
let dragging: string | undefined;

screen.addEventListener('mousedown', (e) => {
  screen.focus();
  dragging = BUTTONS[e.button];
  if (!dragging) return;
  e.preventDefault();
  vscode.postMessage({ type: 'mouse', button: dragging, action: 'press', modifier: modifiers(e), ...cellAt(e) });
});
window.addEventListener('mousemove', (e) => {
  if (dragging) vscode.postMessage({ type: 'mouse', button: dragging, action: 'drag', modifier: modifiers(e), ...cellAt(e) });
});
window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  vscode.postMessage({ type: 'mouse', button: dragging, action: 'release', modifier: modifiers(e), ...cellAt(e) });
  dragging = undefined;
});
screen.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'mouse', button: 'wheel', action: e.deltaY < 0 ? 'up' : 'down', modifier: modifiers(e), ...cellAt(e) });
  },
  { passive: false },
);
screen.addEventListener('contextmenu', (e) => e.preventDefault());

// Sizing ---------------------------------------------------------------------

let lastSize = '';
function reportSize(): void {
  const cols = Math.max(20, Math.floor(window.innerWidth / cell.width));
  const rowsCount = Math.max(5, Math.floor(window.innerHeight / cell.height));
  const key = `${cols}x${rowsCount}`;
  if (key !== lastSize) {
    lastSize = key;
    vscode.postMessage({ type: 'resize', cols, rows: rowsCount });
  }
}

new ResizeObserver(() => reportSize()).observe(document.body);
measure();
reportSize();
screen.focus();
vscode.postMessage({ type: 'ready' });
