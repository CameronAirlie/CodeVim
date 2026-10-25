-- Window management glue: VS Code focus -> Neovim, plus <C-w> mappings and
-- :q / :sp / :vs style commands that drive VS Code editor groups instead of
-- Neovim windows while you are editing a mirrored document.
local rpc = require('codevim.rpc')
local util = require('codevim.util')

local M = {}

local last_bound_buf = nil

local function is_bound(buf)
  return vim.b[buf or 0].codevim_uri ~= nil
end

--- A real document (not a plugin buffer shown as an editor).
local function is_document(buf)
  return is_bound(buf) and not vim.b[buf or 0].codevim_foreign
end

local function action(name, args)
  rpc.notify('action', { name = name, args = args })
end

local function main_window()
  local cur = vim.api.nvim_get_current_win()
  if not util.is_float(cur) then
    return cur
  end
  local prev = vim.fn.win_getid(vim.fn.winnr('#'))
  if prev ~= 0 and not util.is_float(prev) then
    return prev
  end
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if not util.is_float(w) then
      return w
    end
  end
  return cur
end

local function close_floats()
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local cfg = vim.api.nvim_win_get_config(w)
    if cfg.relative ~= '' and cfg.focusable ~= false then
      pcall(vim.api.nvim_win_close, w, true)
    end
  end
end

--- Makes `buf` the current buffer because VS Code focused its editor.
---@param p table { buf, line, col16, top? }
function M.focus(p)
  util.internal(function()
    local mode = vim.api.nvim_get_mode().mode
    if mode:sub(1, 1) == 'c' or util.is_visual(mode) then
      vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<C-\\><C-n>', true, false, true), 'nx', false)
    end
    if util.is_float(0) then
      close_floats()
    end
    local win = main_window()
    if vim.api.nvim_get_current_win() ~= win then
      vim.api.nvim_set_current_win(win)
    end
    if vim.api.nvim_win_get_buf(win) ~= p.buf then
      -- Record a jump so <C-o> / <C-i> travel between VS Code editors too.
      pcall(vim.cmd, "normal! m'")
      vim.api.nvim_win_set_buf(win, p.buf)
    end
    if p.top then
      require('codevim.state').set_viewport(p.buf, p.top)
    end
    require('codevim.cursor').set_cursor(p.buf, p.line, p.col16)
  end)
end

--- Leaves a plugin/special buffer and returns to the last mirrored document.
function M.leave_special()
  if util.is_float(0) then
    close_floats()
    return
  end
  local target = last_bound_buf
  if not (target and vim.api.nvim_buf_is_valid(target) and is_document(target)) then
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      if is_document(b) then
        target = b
        break
      end
    end
  end
  if target then
    vim.api.nvim_win_set_buf(0, target)
  end
end

local function quit(opts)
  if vim.b.codevim_foreign then
    -- A plugin buffer shown as a VS Code editor: close that editor; the extension
    -- then closes the Neovim window.
    rpc.notify('quit', { bang = opts.bang or false, all = false, uri = vim.b.codevim_uri, foreign = true })
    return
  end
  if not is_bound(0) then
    -- A plugin window (help, fugitive, quickfix…). Close it like Neovim would, but
    -- never let the last window close Neovim itself.
    local wins = #vim.tbl_filter(function(w)
      return not util.is_float(w)
    end, vim.api.nvim_tabpage_list_wins(0))
    if wins > 1 or util.is_float(0) then
      vim.cmd(opts.bang and 'quit!' or 'quit')
    else
      M.leave_special()
    end
    return
  end
  if opts.write then
    vim.cmd('write')
  end
  rpc.notify('quit', { bang = opts.bang or false, all = opts.all or false, uri = vim.b.codevim_uri })
end

local function split(direction, file, new)
  local path = file and file ~= '' and vim.fn.fnamemodify(file, ':p') or nil
  rpc.notify('split', { direction = direction, file = path, new = new or false })
end

local wincmds = {
  h = 'workbench.action.focusLeftGroup',
  j = 'workbench.action.focusBelowGroup',
  k = 'workbench.action.focusAboveGroup',
  l = 'workbench.action.focusRightGroup',
  w = 'workbench.action.focusNextGroup',
  W = 'workbench.action.focusPreviousGroup',
  p = 'workbench.action.focusPreviousGroup',
  t = 'workbench.action.focusFirstEditorGroup',
  b = 'workbench.action.focusLastEditorGroup',
  v = 'workbench.action.splitEditorRight',
  s = 'workbench.action.splitEditorDown',
  c = 'workbench.action.closeActiveEditor',
  q = 'workbench.action.closeActiveEditor',
  o = 'workbench.action.closeEditorsInOtherGroups',
  ['='] = 'workbench.action.evenEditorWidths',
  ['_'] = 'workbench.action.toggleEditorWidths',
  ['|'] = 'workbench.action.toggleEditorWidths',
  H = 'workbench.action.moveEditorToLeftGroup',
  J = 'workbench.action.moveEditorToBelowGroup',
  K = 'workbench.action.moveEditorToAboveGroup',
  L = 'workbench.action.moveEditorToRightGroup',
  ['>'] = 'workbench.action.increaseViewWidth',
  ['<lt>'] = 'workbench.action.decreaseViewWidth',
  ['+'] = 'workbench.action.increaseViewHeight',
  ['-'] = 'workbench.action.decreaseViewHeight',
}

local function map_wincmds()
  for key, command in pairs(wincmds) do
    local wincmd_key = key == '<lt>' and '<' or key
    local fn = function()
      if is_bound(0) then
        action(command)
      else
        -- Inside plugin windows keep real Neovim window behaviour.
        vim.cmd.wincmd({ args = { wincmd_key }, count = vim.v.count1 })
      end
    end
    local opts = { desc = 'CodeVim: ' .. command }
    vim.keymap.set({ 'n', 'x' }, '<C-w>' .. key, fn, opts)
    if key:match('^%l$') then
      vim.keymap.set({ 'n', 'x' }, '<C-w><C-' .. key .. '>', fn, opts)
    end
  end
end

-- Command-line words that are redirected to CodeVim commands.
local abbreviations = {
  q = 'CodeVimQuit',
  qu = 'CodeVimQuit',
  qui = 'CodeVimQuit',
  quit = 'CodeVimQuit',
  clo = 'CodeVimQuit',
  close = 'CodeVimQuit',
  wq = 'CodeVimWriteQuit',
  x = 'CodeVimExit',
  xi = 'CodeVimExit',
  xit = 'CodeVimExit',
  exi = 'CodeVimExit',
  exit = 'CodeVimExit',
  qa = 'CodeVimQuitAll',
  qall = 'CodeVimQuitAll',
  quita = 'CodeVimQuitAll',
  quitall = 'CodeVimQuitAll',
  wqa = 'CodeVimWriteQuitAll',
  wqall = 'CodeVimWriteQuitAll',
  xa = 'CodeVimWriteQuitAll',
  xall = 'CodeVimWriteQuitAll',
  sp = 'CodeVimSplit',
  split = 'CodeVimSplit',
  vs = 'CodeVimVsplit',
  vsplit = 'CodeVimVsplit',
  new = 'CodeVimNew',
  vne = 'CodeVimVnew',
  vnew = 'CodeVimVnew',
  on = 'CodeVimOnly',
  only = 'CodeVimOnly',
}

local function define_commands()
  local cmd = vim.api.nvim_create_user_command
  cmd('CodeVimQuit', function(o)
    quit({ bang = o.bang })
  end, { bang = true })
  cmd('CodeVimWriteQuit', function(o)
    quit({ bang = o.bang, write = true })
  end, { bang = true })
  cmd('CodeVimExit', function(o)
    quit({ bang = o.bang, write = vim.bo.modified })
  end, { bang = true })
  cmd('CodeVimQuitAll', function(o)
    if is_bound(0) or not o.bang then
      rpc.notify('quit', { bang = o.bang, all = true })
    end
  end, { bang = true })
  cmd('CodeVimWriteQuitAll', function()
    vim.cmd('silent! wall')
    rpc.notify('quit', { bang = false, all = true })
  end, {})
  cmd('CodeVimSplit', function(o)
    split('down', o.args)
  end, { nargs = '?', complete = 'file' })
  cmd('CodeVimVsplit', function(o)
    split('right', o.args)
  end, { nargs = '?', complete = 'file' })
  cmd('CodeVimNew', function()
    split('down', nil, true)
  end, {})
  cmd('CodeVimVnew', function()
    split('right', nil, true)
  end, {})
  cmd('CodeVimOnly', function()
    if is_bound(0) then
      action('workbench.action.closeEditorsInOtherGroups')
    else
      vim.cmd('only')
    end
  end, {})
end

local function define_abbreviations()
  for word, command in pairs(abbreviations) do
    vim.cmd(
      ("cnoreabbrev <expr> %s (getcmdtype() ==# ':' && getcmdline() ==# '%s') ? '%s' : '%s'"):format(
        word,
        word,
        command,
        word
      )
    )
  end
end

function M.setup(opts)
  define_commands()
  if opts.window_keymaps ~= false then
    map_wincmds()
    vim.keymap.set('n', 'ZZ', '<Cmd>CodeVimExit<CR>', { desc = 'CodeVim: save and close editor' })
    vim.keymap.set('n', 'ZQ', '<Cmd>CodeVimQuit!<CR>', { desc = 'CodeVim: close editor without saving' })
  end
  if opts.command_abbreviations ~= false then
    define_abbreviations()
  end
  vim.api.nvim_create_autocmd('BufEnter', {
    group = vim.api.nvim_create_augroup('codevim.window', { clear = true }),
    callback = function(ev)
      if is_document(ev.buf) then
        last_bound_buf = ev.buf
      end
    end,
  })
end

return M
