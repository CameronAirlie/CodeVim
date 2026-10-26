# CodeVim guide

CodeVim runs **your real Neovim, with your own config**, as the editing engine inside
VS Code. VS Code stays in charge of files, language servers, the UI and saving.
Neovim handles every keystroke and runs your mappings and plugins.

This guide covers installation, daily use, how it works internally, configuration,
and how to change or extend it.

---

## 1. Install

Requirements: **Neovim 0.10+** on your `PATH` (0.11 recommended) and VS Code 1.90+.

1. **Disable vscode-neovim** (or any other Vim extension). Only one extension can own
   VS Code's `type` command, so two Vim extensions conflict.
2. Install the packaged extension:

   ```powershell
   code --install-extension C:\Users\cam\dev\CodeVim\codevim-0.1.0.vsix
   ```

   Or use *Extensions view → … → Install from VSIX…*.
3. Reload VS Code. The status bar shows `-- NORMAL --`, and the log is under
   *Output → CodeVim*.

To rebuild from source:

```powershell
npm install
npm run package          # builds and writes codevim-<version>.vsix
```

For development, open the folder in VS Code and press `F5`. That starts an Extension
Development Host with CodeVim loaded. Run `npm run watch` to rebuild on save.

### Your existing config just works

CodeVim sets **both** `vim.g.codevim` and `vim.g.vscode`, and it provides a
`require('vscode')` module with the same API as vscode-neovim. Your `init.lua`
already branches on `vim.g.vscode`, so it loads `plugins_vscode` and
`vscode_status.lua` unchanged. This was checked by running the test suite against
your config.

Your `vscode_status.lua` mode hooks call `neovim-ui-indicator.*` commands. Those keep
working as long as that extension is installed.

---

## 2. Everyday use

### Modes and typing

| You do                                          | What happens                                                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type in normal / visual / operator-pending mode | Every key goes to Neovim. Your mappings, counts, operators, text objects, macros, registers and plugins (surround, treesj, ts-comments…) all apply.                                 |
| Enter insert mode (`i`, `a`, `o`, `cw`…)        | VS Code takes over typing, so IntelliSense, snippets, auto-closing, multi-cursor and IME all work. Every change is mirrored into Neovim.                                            |
| `<Esc>` (or `ctrl+[`)                           | Leaves insert mode. Plain typing is replayed into Neovim so **`.` repeats it** and **`u` undoes the whole insert in one step**.                                                     |
| `:`, `/`, `?`                                   | The command line appears in the status bar (highlighted). Keys keep going to Neovim, so history, `<Tab>` completion (wildmenu shown inline), `<C-r>` and cmdline mappings all work. |
| Search                                          | `hlsearch` / `incsearch` matches are highlighted with VS Code's find colours.                                                                                                       |
| Select with the mouse or `shift+arrows`         | Neovim enters visual mode with that selection, so `d`, `y`, `gc` and `S)` act on it.                                                                                                |
| Click                                           | Moves Neovim's cursor.                                                                                                                                                              |
| Scroll                                          | Neovim's view follows, and the cursor is pulled into view as in Vim. `zz`, `zt`, `<C-d>`, `<C-u>` and `scrolloff` scroll the VS Code editor.                                        |

The cursor shape follows the mode: a line where you can type (insert and replace
mode) and a block everywhere else (`codevim.cursorStyle.<mode>` changes it). The `-- MODE --` item on the left of the status bar opens the
log. `recording @q` and pending keys (`showcmd`) appear in the status bar too.

### Folding, jumps and undo

- **Folds belong to VS Code.** `zc`, `zo`, `za`, `zC`, `zO`, `zA`, `zv`, `zR`, `zM`
  fold and unfold in the VS Code editor (counts work: `2zc` closes two levels), `zj`,
  `zk` and `[z` move between folds, and in visual mode `zf` creates a fold and `zd`
  removes it. `j`, `k`, `gj`, `gk` and the arrow keys step over a collapsed fold the
  way they step over a closed fold in Vim. Neovim's own folds (`foldmethod`) are turned
  off in windows that show a document, so they can't hide lines VS Code shows.
- **One jump history.** VS Code's *Go Back* / *Go Forward* keys (`alt+left` /
  `alt+right` on Windows) run `<C-o>` / `<C-i>` in normal mode. Jumps made by VS Code
  (Go to Definition, Go to Line, outline, search results) are added to Neovim's
  jumplist, so `<C-o>` returns from them too.
- **One undo history.** Outside insert mode `ctrl+z` runs `u` and `ctrl+shift+z` runs
  `<C-r>` (`ctrl+y` too, unless `y` is in `ctrlKeys.normal`, where it scrolls). Undo
  and Redo from the Edit menu or other extensions also go through Neovim's undo tree.
  In insert mode VS Code's undo applies to what you're typing.

**Visual blocks past the end of a line.** `<C-v>` blocks can extend into the empty
space after shorter lines, as with Vim's `:set virtualedit=block` (CodeVim sets it when
your config leaves `virtualedit` empty). VS Code can't select past the end of a line,
so that part of the block, and the cursor when it is out there, is drawn after the
text.

If your config already maps one of these keys, CodeVim leaves your mapping alone, and
*CodeVim: Check Health* lists it.

### Navigation between VS Code and Neovim

Both sides stay pointed at the same file:

- **VS Code → Neovim:** focusing any editor (tab click, `Ctrl+P`, Go to Definition,
  Explorer) makes that buffer current in Neovim. Each switch records a jump, so
  **`<C-o>` / `<C-i>` walk back and forth across editors**.
- **Neovim → VS Code:** `:e file`, `:b`, `:bnext`, `<C-^>` (your `<leader><leader>`),
  `gf`, `<C-o>`, Telescope and Oil picks open the file in a VS Code editor.
  `:enew` (your `<leader>n`) opens a new untitled VS Code document. `:bd` closes
  the editor.
- **Windows → editor groups:**

| Neovim                             | VS Code                                      |
| ---------------------------------- | -------------------------------------------- |
| `<C-w>h/j/k/l`                     | focus the group left/down/up/right           |
| `<C-w>w` / `<C-w>W` / `<C-w>p`     | next / previous group                        |
| `<C-w>v`, `:vs [file]`             | split right                                  |
| `<C-w>s`, `:sp [file]`             | split down                                   |
| `:new`, `:vnew`                    | new untitled editor in a split               |
| `<C-w>q`, `<C-w>c`, `:q`, `:close` | close the editor                             |
| `<C-w>o`, `:only`                  | close other groups                           |
| `<C-w>=`, `<C-w>_`, `<C-w>\|`      | even out / maximise group sizes              |
| `<C-w>H/J/K/L`                     | move the editor to another group             |
| `:w`, `:wa`                        | saved by VS Code (format-on-save etc. apply) |
| `:wq`, `:x`, `ZZ`                  | save and close                               |
| `:q!`, `ZQ`                        | revert and close                             |
| `:qa`, `:wqa`, `:xa`               | close all editors                            |

Inside plugin windows (help, fugitive, quickfix…) the `<C-w>` keys and `:q` keep their
normal Neovim meaning. `:q` in the last plugin window returns to your file instead of
quitting Neovim.

### Plugin UIs

Plugin UIs show up inside VS Code itself, in your VS Code theme. Nothing opens a
separate window.

**Floating windows** (Telescope, Lazy, Navbuddy, which-key, gitsigns previews,
hover popups…) are drawn **on top of the editor you're in**, at the position Neovim
puts them. While Neovim's focus is in a float (for example the Telescope prompt),
every key goes to it, including `<Esc>`, `<CR>`, arrows and `ctrl+<letter>`
(`codevim.ctrlKeys.plugin`). Your file is not touched. Picking a Telescope result
opens it in VS Code. Clicking the editor closes the float.

Colours follow the VS Code theme (`codevim.floats.colors: "vscode"`):

- the float's base colours become the widget background and foreground,
- the selected entry uses the list selection colour,
- borders use the widget border colour,
- accent colours (matches, icons) keep Neovim's values.

Set `"neovim"` to use your Neovim colourscheme instead.

**Plugin buffers** (`:help`, Oil, fugitive `:Git`, vim-flog, quickfix,
`:terminal`) open as **ordinary VS Code editors** with your theme and font. If Neovim
opened them in a split (`:help`, `:Git`, `:copen`) they go beside the current editor;
otherwise (Oil) they replace it (`codevim.pluginBuffers.viewColumn`). Neovim owns
them: keys go through your mappings (Oil's `<CR>`, fugitive's `s`/`cc`, help's
`<C-]>`), and their content updates as the plugin changes it. `:w` in Oil applies
your changes, and saving the editor with `ctrl+s` does the same. `:q` or closing the
tab closes the plugin window.

Start screens (snacks/alpha/dashboard/mini.starter) are skipped, since VS Code has its
own.

**The Neovim surface** (opt-in) is the previous behaviour: a tab that renders
Neovim's own screen with your colourscheme. Use it for either kind of view with
`codevim.floats.display: "surface"` and/or `codevim.pluginBuffers.display: "surface"`.

### Calling VS Code from your config

```lua
local vscode = require('vscode')

vscode.action('editor.action.formatDocument')               -- async
vscode.action('editor.action.rename', { callback = function(err) end })
local r = vscode.call('workbench.action.files.save')         -- waits, returns the result
vscode.action('editor.action.commentLine', { range = { 3, 10 } }) -- lines 3-10 (0-based)
local n = vscode.eval('return vscode.window.activeTextEditor.document.lineCount')
vscode.eval_async('await vscode.env.clipboard.writeText(args.t)', { args = { t = 'hi' } })
vscode.notify('Hello from Neovim', vim.log.levels.WARN)
vscode.get_config('editor.tabSize'); vscode.update_config('editor.tabSize', 2)
```

Also available:

- `vim.notify()` shows VS Code notifications (`codevim.notifications.routeVimNotify`).
- The `+` and `*` registers use VS Code'
- s clipboard, so your `<leader>y` / `<leader>p`
  work without win32yank (`codevim.clipboard.useVscode`).
- `vim.g.codevim == 1` or `require('codevim').active()` tells your config it is
  running inside CodeVim.

### Making the most of your config

Telescope and Oil only live in `plugins_nvim`. To use them inside VS Code (Telescope
draws over the editor, Oil opens as an editor), load them when running under CodeVim. In
`lua/config/lazy.lua`:

```lua
local spec = { { import = vim.g.vscode and 'plugins_vscode' or 'plugins_nvim' } }
if vim.g.codevim then
  -- CodeVim can display plugin UIs, so add the navigation plugins.
  table.insert(spec, { import = 'plugins_nvim.navigation' })
end
require('lazy').setup({ spec = spec, --[[ rest unchanged ]] })
```

(For `import = 'plugins_nvim.navigation'` to work, `navigation.lua` must return a
spec list, which it already does.)

CodeVim keeps Neovim's window the same height as the visible editor. Built-in
`<C-d>`, `<C-u>`, `<C-f>`, `<C-b>`, `H`, `M` and `L` therefore already behave
correctly, and the `visibleRanges` workarounds in `vscode_status.lua` are optional
under CodeVim:

```lua
if vim.g.vscode and not vim.g.codevim then
  -- vscode-neovim-only <C-d>/<C-u>/<C-f>/<C-b> workarounds
end
```

To give VS Code its own Neovim config instead, set `codevim.neovimAppName` (for
example `nvim-vscode`, which reads `~/AppData/Local/nvim-vscode`) or pass
`["-u", "path/to/init.lua"]` in `codevim.neovimArgs`.

---

## 3. Settings

All settings live under `codevim.*` (open Settings and search for "CodeVim"). The main
ones:

| Setting                                              | Default           | Purpose                                                                                  |
| ---------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `neovimPath`                                         | `nvim`            | Neovim executable                                                                        |
| `neovimArgs` / `neovimAppName`                       | `[]` / `""`       | extra args / `NVIM_APPNAME` for a separate config                                        |
| `setVscodeGlobal`                                    | `true`            | also set `vim.g.vscode` for vscode-neovim compatibility                                  |
| `insert.strategy`                                    | `vscode`          | `neovim` (experimental) sends insert-mode keys to Neovim as well                         |
| `insert.escapeSequence`                              | `""`              | e.g. `jk` to leave insert mode                                                           |
| `insert.dotRepeat`                                   | `true`            | replay VS Code typing so `.` works                                                       |
| `ctrlKeys.normal` / `.insert` / `.cmdline`           | see Settings      | which `ctrl+<key>` combos go to Neovim in each mode; the rest keep their VS Code meaning |
| `ctrlKeys.fromNeovim`                                | `true`            | in the cmdline (and insert mode with `insert.strategy: neovim`), Ctrl keys Neovim gives a meaning, built in or mapped, go to Neovim |
| `features`                                           | `{}`              | turn off optional features, e.g. `{ "surface": false, "viewport": false }`               |
| `floats.display`                                     | `overlay`         | `overlay` (over the editor) / `surface` / `none`                                         |
| `floats.colors`                                      | `vscode`          | map float colours to the VS Code theme, or keep `neovim`'s                               |
| `pluginBuffers.display`                              | `editor`          | help/oil/fugitive/quickfix as VS Code editors, or on the `surface`                       |
| `pluginBuffers.viewColumn`                           | `auto`            | `auto` (beside when Neovim split) / `active` / `beside`                                  |
| `ctrlKeys.plugin`                                    | a–z, `[`, `]`     | `ctrl+<key>` combos sent to Neovim while a float or plugin buffer has its focus          |
| `uiWidth`                                            | `120`             | Neovim's screen width; floats size themselves to it, so match your editor's columns      |
| `surface.*`                                          |                   | options for the opt-in surface tab (placement, font, passthrough keys)                  |
| `navigation.windowKeymaps` / `.commandAbbreviations` | `true`            | `<C-w>` and `:q`/`:sp` mapping                                                           |
| `viewport.syncScroll`                                | `true`            | sync scrolling both ways                                                                 |
| `cursorStyle.<mode>`                                 | block/line/…      | cursor shape per mode                                                                    |
| `features`: `folding` / `jumplist` / `undo`          | on                | fold keys, Go Back/Forward via the jumplist, undo through Neovim                         |
| `visualBlock.pastLineEnd`                            | `true`            | `<C-v>` blocks can extend past short lines (`virtualedit=block` if your config sets none) |
| `statusline.position`                                | `statusBar`       | mode/cmdline/messages in VS Code's status bar, or `editor` for a Vim-style line          |
| `statusline.colors`                                  | ANSI theme colors | per-mode colour of the mode indicator (status bar text, or the in-editor line)           |

**Ctrl keys.** By default normal mode sends `ctrl+a b d e f i o r u v w x y ] 6 [`
to Neovim. `ctrl+p`, `ctrl+s`, `ctrl+c` and the others stay with VS Code. Add a
letter to `codevim.ctrlKeys.normal` to give that key to Neovim. `ctrl+r` is not in
the insert list by default, because waiting for a register name doesn't fit
VS Code-handled typing.

**Commands** (Command Palette, "CodeVim:"): *Restart Neovim*, *Toggle* (also
`ctrl+shift+alt+n`), *Resync all documents*, *Show Log*, *Show Neovim Messages*,
*Show Neovim Surface*, *Check Health*, *Jump Back* / *Jump Forward*, *Undo* / *Redo*.

**Startup and health.** While Neovim starts, the status bar shows what it is doing
("loading your config"…). *CodeVim: Check Health* checks the Neovim executable and
version, whether startup finished, conflicting extensions (VSCodeVim, VSCode Neovim),
settings, and the Neovim side (config file, clipboard, mappings your config took
over). If Neovim fails to start, the error notification offers it too. Inside Neovim,
`:checkhealth codevim` runs the Neovim-side checks.

---

## 4. How it works

```
┌──────────────────────── VS Code extension host ────────────────────────┐
│ extension.ts ── Controller (start / stop / restart on crash)            │
│        │                                                                │
│     Runtime ── NvimSession ── RpcClient ═══ msgpack-rpc (stdio) ═══╗    │
│        │           │  (typed Lua events, request handlers, ModeState)║    │
│        ├── DocumentManager / DocumentBinding  (text sync)            ║    │
│        ├── UiSizeController                                          ║    │
│        └── Features: input · cursor · mode · navigation · viewport   ║    │
│                      cmdline · messages · searchHighlight            ║    │
│                      optionSync · folding · jumplist · undo          ║    │
│                      bridge · fileCommands · surface ──────────────┐ ║    │
│                                                    webview (grid) ◄┘ ║    │
└──────────────────────────────────────────────────────────────────────╫────┘
                                                                       ║
┌───────────────────── nvim --embed (your config) ─────────────────────╨────┐
│ bootstrap.lua → require('codevim').setup()   (runs before init.lua)       │
│   codevim.buffer   attach/apply_edits/escape, :w → VS Code                │
│   codevim.state    reports mode/cursor/window/viewport/search             │
│   codevim.cursor   cursor & selection from VS Code                        │
│   codevim.window   focus, <C-w> maps, :q/:sp commands                     │
│   codevim.fold / .jumplist / .undo   halves of those features             │
│   codevim.keymap   default maps that never override yours                 │
│   codevim.health   :checkhealth codevim and the VS Code health report     │
│   codevim.clipboard, codevim.notify, vscode (compat API)                  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Startup

1. `NvimSession.start` spawns `nvim --embed` in the workspace folder and connects
   over msgpack-rpc (`src/nvim/rpc.ts`, a small client built on `@msgpack/msgpack`).
2. Before Neovim sources your config, `runtime/bootstrap.lua` registers the CodeVim
   Lua modules in `package.preload` and calls `require('codevim').setup()`.
   `package.preload` is used because lazy.nvim resets `runtimepath`; this way
   `require('vscode')` and `vim.g.vscode` are ready when `init.lua` runs.
3. The UI attaches (`ext_linegrid`, `ext_cmdline`, `ext_messages`, `ext_popupmenu`),
   which is the point where `--embed` loads your config. CodeVim waits for `VimEnter`.
   Each stage is reported to a status bar progress indicator (`onProgress`).

### Text sync (`src/sync/documentManager.ts`)

Each VS Code document has one Neovim buffer and one `DocumentBinding`.

- **VS Code → Neovim.** Every content change is sent as `apply_edits` with UTF-16
  positions. Lua converts them to byte columns using the buffer's own text. During an
  insert session the edits are `undojoin`ed into one undo step.
- **Neovim → VS Code.** `nvim_buf_attach` streams line events into `mirror`, an exact
  copy of the buffer. The document is then diffed against the mirror
  (`src/sync/textDiff.ts`) and patched with the smallest edit. Because the diff is
  based on content:
  - echoes of VS Code's own edits produce no change,
  - bursts of Neovim edits (macros, `:%s`) become one VS Code edit,
  - while VS Code edits are still in flight, flushing waits, so a stale mirror can't
    overwrite newer typing.
- On leaving insert mode the mirror is checked against the document. If they ever
  differ, the document wins (*CodeVim: Resync* does the same by hand).
- Existing files are loaded with `bufadd()` + `bufload()`. That way `BufRead*` and
  `FileType` autocmds fire for gitsigns, treesitter and lazy-loaded plugins, and `:w`
  is routed through `BufWriteCmd` to `TextDocument.save()`.

### State reporting

Instead of rebuilding Neovim's state from screen cells, the Lua side reports facts
using autocmds (`ModeChanged`, `CursorMoved`, `WinScrolled`, `BufEnter`, `WinNew`,
`SafeState`, `CmdlineChanged`):

- **mode** and **cursor** (with the visual start and block ranges),
- **window:** the current buffer, classified as `bound`, `file`, `scratch`,
  `special` or `ignored`, plus any open floats,
- **viewport** and **search matches**.

Changes the extension caused itself are flagged `internal`, which prevents feedback
loops. For example, focusing an editor is not treated as Neovim asking to navigate.

### Floats overlay (`src/features/floats/`)

`GridModel` folds the `grid_*` / `hl_attr_define` redraw events into Neovim's screen.
The Lua side reports each float's screen rectangle (border included) and z-index.
`buildOverlay()` (`layout.ts`, pure) cuts those rectangles out of the screen,
maps colours to theme colours, and returns styled runs. The feature draws each run as
an editor decoration anchored to the first visible line, positioned at
`row × lineHeight` / `col ch`. Neovim's screen is sized to the editor's visible lines,
so screen rows land on the matching editor rows.

While Neovim's focus is in a float or an unmirrored buffer, `session.pluginFocused`
is true. Input then routes every key to Neovim, and clicking the editor sends
`focus()`, which closes the float.

### Plugin buffers as editors (`src/sync/bufferFileSystem.ts`)

Buffers classified as `special` are published through an in-memory file system under
the `codevim-buffer:` scheme and opened as normal documents. Their bindings are
*foreign*: Lua adopts the buffer without touching its name, options or autocmds, and
Neovim is the source of truth. Buffer changes are written to the file system, and
VS Code reloads the document. Saving runs `:write` in Neovim. Closing the tab detaches
the buffer and closes its Neovim window.

### The surface (`src/features/surface/`, opt-in)

The same `GridModel` streamed to a webview (`src/webview/surface.ts`) that draws the
whole screen and turns keyboard and mouse events back into `nvim_input` /
`nvim_input_mouse`. While open, it claims Neovim's UI size through
`UiSizeController`. Otherwise the size matches the visible editor, which is what makes
`<C-d>`, `H`/`L` and `scrolloff` correct.

### Keys

`scripts/gen-keybindings.mjs` generates the keybindings in `package.json`. They are
driven by context keys that the input feature keeps up to date:

- `codevim.active`: the focused editor is mirrored,
- `codevim.mode`: `normal`, `insert`, `visual`, `cmdline`, …,
- `codevim.captureKeys`: send special keys to Neovim,
- `codevim.ctrl.<key>`: `ctrl+<key>` goes to Neovim in the current mode (`<key>` is a
  letter, `6`, `space`, `slash`, `lbracket` or `rbracket`),
- `codevim.jumplist` / `codevim.undo`: those features are on (gates their keys).

Printable keys arrive through VS Code's `type` command.

---

## 5. Changing and extending it

The code is split so each behaviour can be changed in isolation:

| Where           | What lives there                                                           |
| --------------- | -------------------------------------------------------------------------- |
| `src/core/`     | vscode-free building blocks: events, disposables, logger, mode parsing     |
| `src/nvim/`     | process + RPC + session, redraw parsing, `protocol.ts` (Lua payload types) |
| `src/sync/`     | pure text/position/selection maths and the document mirror                 |
| `src/features/` | one file per feature; `index.ts` lists them in activation order            |
| `src/webview/`  | the surface's browser-side code                                            |
| `runtime/lua/`  | the Neovim side, one module per concern                                    |

**Adding a feature**

1. Create `src/features/myFeature.ts` that exports a `FeatureDefinition`:

   ```ts
   export const myFeature: FeatureDefinition = {
     id: 'myFeature',
     description: 'What it does',
     create: (ctx) => new MyFeature(ctx), // returns a vscode.Disposable
   };
   ```

   `ctx` gives you `session` (RPC, `session.lua.on('event', …)`, `handleRequest`,
   `call('module', 'fn', args)`, `input(keys)`, `mode`), `documents`, `config`,
   `ui` and `logger`.
2. Add it to `FEATURES` in `src/features/index.ts`. Users can turn it off with
   `"codevim.features": { "myFeature": false }` (add it to the `codevim.features`
   schema in `package.json` so it shows in Settings).
3. If it needs new data from Neovim, add a payload type to `src/nvim/protocol.ts`
   (`LuaEvents` or `LuaRequests`) and send it from Lua with
   `require('codevim.rpc').notify('name', payload)` or `.request(...)`.
4. If it has a Lua half, put it in `runtime/lua/codevim/<name>.lua` with
   `enable()` / `disable()` and call them from the feature (see `folding.ts`).
   Install keymaps with `require('codevim.keymap').set('<feature>', modes, lhs, rhs)`:
   a key the user's config already maps is skipped and reported by the health check.
5. To handle a VS Code edit yourself instead of having it mirrored into Neovim, use
   `ctx.documents.interceptChanges((binding, e) => …)` and return `true`; then bring
   the two back in step with `binding.restoreFromNeovim()` (see `undo.ts`).

**Adding a health check:** implement `HealthCheck` in `src/health/checks/` and add it
to `HEALTH_CHECKS` in `src/health/index.ts`. Checks get the config and the runtime (if
Neovim is running) and must work without it. Neovim-side checks go in
`runtime/lua/codevim/health.lua` and show up in both reports.

**Changing keybindings:** edit `scripts/gen-keybindings.mjs`, then run
`npm run gen:keybindings`.

**Tests**

```powershell
npm run typecheck
npm test            # unit tests + integration tests against a real headless Neovim
npm run test:e2e    # end-to-end inside a separate VS Code instance (isolated profile)
node test/e2e/run.mjs --user-config   # same, using your real Neovim config
```

If you run the e2e suite from VS Code's integrated terminal, clear
`ELECTRON_RUN_AS_NODE` first. In PowerShell: `$env:ELECTRON_RUN_AS_NODE=$null`.

**Debugging:** *CodeVim: Show Log*. Set the channel's log level to *Trace* (gear icon
in the Output view) to see every Lua event. Setting the environment variable
`CODEVIM_LOG_FILE=C:\path\codevim.log` also mirrors the log to a file.

---

## 6. Known limitations

- **One Neovim window mirrors the active editor.** Other visible editors are separate
  buffers that become current when you focus them; they are not Neovim splits.
- **`.` after an insert** is replayed only for plain typing on one line (including
  backspace). Inserts with newlines, auto-closed brackets or jumps around the line
  still edit correctly, but `.` won't repeat them. `insert.strategy: "neovim"` sends
  everything through Neovim but is experimental.
- **Float overlays are positioned with decorations.** The VS Code API can't place UI
  freely, so CodeVim attaches positioned decorations to the first visible line. It
  works in current VS Code but relies on how editor decorations are rendered. If a
  VS Code update breaks it, switch to `floats.display: "surface"`. Floats are sized to
  `codevim.uiWidth` columns, because VS Code doesn't expose an editor's width in
  columns. Icons need a Nerd Font in `editor.fontFamily`. The VS Code cursor stays
  visible under a float.
- **Plugin buffers are reloaded as a whole** when they change. That is fine for help,
  Oil and fugitive, but a busy `:terminal` updates in steps.
- **Live `:substitute` preview** (`inccommand`) is turned off, because it would edit
  the VS Code document.
- **Scrolling can drift** when VS Code word-wrap differs from Neovim's.
- **Folds are only known inside the viewport.** VS Code doesn't say which folds are
  collapsed, so CodeVim works them out from the visible ranges. `j` from the last
  visible line onto a fold below the screen opens that fold instead of skipping it.
- **Undo in insert mode** is VS Code's. The text you type is mirrored into Neovim as
  usual, so `u` afterwards undoes the whole insert.
- **Two extensions binding the same key:** whichever was registered later wins. If
  another extension takes a key you want, add your own keybinding for
  `codevim.send` with `"args": "<C-x>"`.
- **Not exercised:** Remote/WSL/Dev Containers and notebooks (`vscode-notebook-cell`
  isn't in `documentSchemes` by default).
