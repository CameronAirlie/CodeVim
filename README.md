<p align="center">
  <img src="media/codevim-logo.png" alt="CodeVim logo" width="128" height="128">
</p>

<h1 align="center">Neovim in VS Code</h1>

<p align="center">
  <b>Your real Neovim — your <code>init.lua</code>, your mappings, your plugins — as the editing engine inside VS Code.</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=CameronAirlie.CameronAirlie-codevim"><img src="https://vsmarketplacebadges.dev/version/CameronAirlie.CameronAirlie-codevim.svg?label=Marketplace&color=3fa9f5" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=CameronAirlie.CameronAirlie-codevim"><img src="https://vsmarketplacebadges.dev/installs-short/CameronAirlie.CameronAirlie-codevim.svg?label=Installs&color=7ed957" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=CameronAirlie.CameronAirlie-codevim&ssr=false#review-details"><img src="https://vsmarketplacebadges.dev/rating-star/CameronAirlie.CameronAirlie-codevim.svg?label=Rating" alt="Rating"></a>
  <a href="https://github.com/CameronAirlie/CodeVim/actions/workflows/ci.yml"><img src="https://github.com/CameronAirlie/CodeVim/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/CameronAirlie/CodeVim/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Neovim-0.10%2B-57A143?logo=neovim&logoColor=white" alt="Neovim 0.10+">
  <img src="https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC?logo=visualstudiocode&logoColor=white" alt="VS Code 1.90+">
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-getting-started">Getting started</a> ·
  <a href="#%EF%B8%8F-settings">Settings</a> ·
  <a href="#-commands">Commands</a> ·
  <a href="#-known-limitations">Limitations</a> ·
  <a href="https://github.com/CameronAirlie/CodeVim/blob/main/CHANGELOG.md">Changelog</a>
</p>

---

CodeVim runs a real Neovim process and hands it every keystroke. Neovim does the
editing — motions, operators, text objects, macros, registers, your mappings and your
plugins — while VS Code keeps doing what it is good at: files, language servers,
IntelliSense, the UI and saving. The two stay in sync in both directions.

> **Preview.** CodeVim is used daily, but expect rough edges — please
> [report anything odd](https://github.com/CameronAirlie/CodeVim/issues).

## ✨ Features

- 🧠 **Your config, unchanged.** CodeVim sets `vim.g.vscode` and ships a
  `require('vscode')` module compatible with vscode-neovim, so configs written for it
  load as-is.
- ⌨️ **Real Vim editing.** Counts, operators, text objects, macros, registers,
  `.` repeat and one undo tree — not an emulation.
- 💡 **VS Code typing in insert mode.** IntelliSense, snippets, auto-closing,
  multi-cursor and IME keep working, and plain typing still repeats with `.`.
- 🔀 **Pick your language features.** `codevim.languageFeatures` chooses who does
  LSP and completion: `vscode` (IntelliSense; Neovim's LSP and completion plugins
  step aside, and `K`, `gd`, `grn`, `]d` run VS Code commands) or `neovim` (your
  Neovim LSP and blink.cmp / nvim-cmp).
- 🪟 **Plugin UIs in your editor.** Telescope, which-key, Lazy, completion menus and
  hover popups are drawn over the editor in your VS Code theme. Help, Oil, fugitive
  and quickfix open as VS Code editors.
- 🧭 **One navigation model.** `:e`, `gf`, `<C-o>`/`<C-i>` and Telescope picks open
  VS Code editors; `<C-w>` splits and moves map to editor groups; VS Code's Go Back /
  Go Forward walk Neovim's jumplist.
- 📁 **Folds, search and cursor done natively.** `zc`/`zo`/`za` drive VS Code folds,
  `hlsearch` uses VS Code's find colours, and the cursor shape follows the mode.
- 🩺 **Health checks.** *CodeVim: Check Health* explains what's wrong when something
  is — Neovim version, conflicting extensions, settings, mappings your config took
  over.

## 🚀 Getting started

1. **Install Neovim 0.10 or newer** (0.11 recommended) and make sure `nvim` is on your
   `PATH` — or point `codevim.neovimPath` at it.
2. **Disable other Vim extensions** (VSCodeVim, VSCode Neovim). Only one extension
   can own VS Code's typing.
3. **Install CodeVim** from the Marketplace and reload the window. The status bar
   shows `-- NORMAL --` once Neovim is up.

Something not right? Run **CodeVim: Check Health** from the Command Palette, or open
**CodeVim: Show Log**.

### Using a separate config

Keep VS Code-specific settings apart from your terminal setup with any of:

```lua
-- in init.lua
if vim.g.vscode then
  -- running inside VS Code (CodeVim or vscode-neovim)
end

if require('codevim').active() then
  -- running inside CodeVim specifically
end
```

or give CodeVim its own config directory with `codevim.neovimAppName`
(sets `NVIM_APPNAME`).

### Calling VS Code from Lua

```lua
local vscode = require('vscode')
vscode.action('editor.action.formatDocument')
vscode.action('editor.action.rename')
vscode.update_config('editor.tabSize', 2)
```

## ⚙️ Settings

All settings live under `codevim.*`. The ones you are most likely to touch:

| Setting | Default | What it does |
| --- | --- | --- |
| `codevim.neovimPath` | `nvim` | Neovim executable |
| `codevim.neovimAppName` | `""` | `NVIM_APPNAME`, for a separate config |
| `codevim.languageFeatures` | `both` | `vscode`: VS Code's LSP and IntelliSense only. `neovim`: your Neovim LSP and completion plugin only. `both`: leave both running |
| `codevim.insert.strategy` | `vscode` | With `languageFeatures: both`, who handles insert-mode typing: `vscode`, or `neovim` (insert mappings, Neovim completion) |
| `codevim.insert.escapeSequence` | `""` | Two keys that leave insert mode, e.g. `jk` |
| `codevim.ctrlKeys.normal` / `.insert` / `.cmdline` | see Settings | Which `ctrl+<key>` combos go to Neovim; the rest keep their VS Code meaning |
| `codevim.ctrlKeys.fromNeovim` | `true` | Also send any Ctrl key Neovim gives a meaning (built in or mapped) |
| `codevim.floats.display` | `overlay` | Draw floats over the editor, on a separate surface, or not at all |
| `codevim.floats.colors` | `vscode` | Paint floats in your VS Code theme, or keep Neovim's colours |
| `codevim.statusline.position` | `statusBar` | Mode, command line and messages in the status bar, or a Vim-style line in the editor |
| `codevim.updates.showReleaseNotes` | `true` | Offer the release notes after an update |

## 📋 Commands

Open the Command Palette and type **CodeVim**:

| Command | |
| --- | --- |
| Restart Neovim | Restart the Neovim process (picks up config changes) |
| Toggle | Turn CodeVim on or off — also `ctrl+shift+alt+n` |
| Check Health | Diagnose installation and configuration problems |
| Resync all documents | Push every open document to Neovim again |
| Show Log / Show Neovim Messages | Troubleshooting output |
| What's New | Open these release notes |

## 🚧 Known limitations

- One Neovim window mirrors the active editor; other visible editors are separate
  buffers, not Neovim splits.
- With the default insert strategy, `.` repeats plain single-line typing only.
- Floats are drawn with editor decorations and sized to `codevim.uiWidth` columns;
  icons need a Nerd Font in `editor.fontFamily`.
- Remote, WSL, Dev Containers and notebooks are untested.

The [full guide](https://github.com/CameronAirlie/CodeVim/blob/main/docs/GUIDE.md)
covers every feature, all settings and how CodeVim works inside.

## 🤝 Contributing

Bug reports and pull requests are welcome on
[GitHub](https://github.com/CameronAirlie/CodeVim). To build from source:

```sh
npm install
npm run build      # or: npm run watch, then F5 in VS Code
npm test
npm run package    # writes a .vsix
```

## 📄 License

[MIT](https://github.com/CameronAirlie/CodeVim/blob/main/LICENSE) © Cameron Airlie
