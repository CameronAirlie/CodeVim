# Changelog

All notable changes to CodeVim are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Add entries under **Unreleased** as you go; `npm run release` turns that section into
the next version.

## [Unreleased]

### Added

- First release: your real Neovim, with your own config, as the editing engine in
  VS Code. Includes vscode-neovim–compatible `vim.g.vscode` and `require('vscode')`,
  VS Code or Neovim handling of insert mode (`codevim.insert.strategy`), plugin
  floats drawn over the editor, plugin buffers as VS Code editors, editor-group
  navigation for `<C-w>` and `:e`/`:q`, VS Code folds for `z` commands, one jumplist
  and one undo tree.
- Vim-style statusline in the status bar or the editor, with per-mode colours.
- *CodeVim: Check Health* and `:checkhealth codevim`.
- Ctrl keys Neovim handles in insert and command-line mode (built-in commands and
  anything your config or plugins map, such as a completion menu's `<C-y>`) go to
  Neovim automatically (`codevim.ctrlKeys.fromNeovim`).
- Floats look like the matching VS Code widget: Quick Open for pickers, its input box
  for prompts, IntelliSense for completion and which-key.
- After an update, CodeVim offers these release notes
  (`codevim.updates.showReleaseNotes`, *CodeVim: What's New*).

### Fixed

- Ctrl-key keybindings ignored their conditions, so every `ctrl+<key>` went to the
  same command in every mode (e.g. `ctrl+y` always ran redo).
- Floats drawn before CodeVim's features started (anything using highlights your
  colorscheme defined at startup) lost their colours.
- Transparent colorschemes painted floats black.

[Unreleased]: https://github.com/CameronAirlie/CodeVim/commits/main
