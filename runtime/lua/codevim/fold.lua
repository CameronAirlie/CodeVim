-- Folding: VS Code draws and owns the folds of mirrored documents.
--
--  * Fold commands (zc, zo, za, zR, zM, zj…) are sent to VS Code, which runs the
--    matching editor.fold* command (src/features/folding.ts).
--  * VS Code reports which lines its collapsed folds hide, and j/k/gj/gk/<Up>/<Down>
--    step over them like they would over a closed fold in Vim.
--  * Neovim's own folds are disabled in windows that show a document, so they can't
--    silently hide lines that VS Code shows.
local keymap = require('codevim.keymap')
local rpc = require('codevim.rpc')
local util = require('codevim.util')

local M = {}

local OWNER = 'fold'

-- Key → action understood by the extension (see FoldAction in protocol.ts).
local normal_actions = {
  zo = 'open',
  zO = 'openRecursive',
  zv = 'open',
  zc = 'close',
  zC = 'closeRecursive',
  za = 'toggle',
  zA = 'toggleRecursive',
  zR = 'openAll',
  zM = 'closeAll',
  zd = 'delete',
  zD = 'delete',
  zE = 'delete',
  zj = 'next',
  zk = 'previous',
  ['[z'] = 'parent',
}
local visual_actions = {
  zf = 'create',
  zd = 'delete',
  zD = 'delete',
}

-- Movements that skip hidden lines: lhs → direction.
local motions = {
  j = 1,
  k = -1,
  gj = 1,
  gk = -1,
  ['<Down>'] = 1,
  ['<Up>'] = -1,
}

--- Lines hidden by collapsed VS Code folds, per buffer: { {first, last}, … } (0-based, inclusive).
---@type table<integer, integer[][]>
local hidden = {}

local function count_prefix()
  return vim.v.count > 0 and tostring(vim.v.count) or ''
end

local function fold_action(lhs, action)
  return function()
    if not util.is_document() then
      keymap.feed_builtin(count_prefix() .. lhs)
      return
    end
    local pos = vim.api.nvim_win_get_cursor(0)
    local payload = { buf = vim.api.nvim_get_current_buf(), action = action, line = pos[1] - 1, count = vim.v.count1 }
    if util.is_visual(vim.api.nvim_get_mode().mode) then
      payload.vline = vim.fn.line('v') - 1
    end
    rpc.notify('fold', payload)
  end
end

--- Target line of moving `count` lines in `dir` from `line`, treating each hidden
--- range as a single line (like a closed fold). All values are 0-based.
function M.step(ranges, line, dir, count, last)
  for _ = 1, count do
    local target = line + dir
    for _, r in ipairs(ranges) do
      if target >= r[1] and target <= r[2] then
        target = dir > 0 and r[2] + 1 or r[1] - 1
        break
      end
    end
    if target < 0 or target > last then
      break
    end
    line = target
  end
  return line
end

local function motion(lhs, dir)
  return function()
    local buf = vim.api.nvim_get_current_buf()
    local ranges = util.is_document(buf) and hidden[buf]
    if not ranges or #ranges == 0 then
      keymap.feed_builtin(count_prefix() .. lhs)
      return
    end
    local cur = vim.api.nvim_win_get_cursor(0)[1] - 1
    local target = M.step(ranges, cur, dir, vim.v.count1, vim.api.nvim_buf_line_count(buf) - 1)
    local delta = target - cur
    if delta ~= 0 then
      -- Plain j/k keep the desired column ('curswant'), like any vertical motion.
      keymap.feed_builtin(math.abs(delta) .. (delta > 0 and 'j' or 'k'))
    end
  end
end

--- Neovim folds are off where VS Code draws the folds; elsewhere the global value applies.
local function update_foldenable(win)
  local value = vim.go.foldenable
  if util.is_document(vim.api.nvim_win_get_buf(win)) then
    value = false
  end
  if vim.wo[win].foldenable ~= value then
    vim.api.nvim_set_option_value('foldenable', value, { scope = 'local', win = win })
  end
end

--- Records the lines VS Code's collapsed folds hide in `buf`.
---@param ranges integer[][] { {first, last}, … } 0-based, inclusive, sorted
function M.set_hidden(buf, ranges)
  hidden[buf] = #ranges > 0 and ranges or nil
end

function M.enable()
  for lhs, action in pairs(normal_actions) do
    keymap.set(OWNER, 'n', lhs, fold_action(lhs, action), { desc = 'CodeVim: ' .. action .. ' fold' })
  end
  for lhs, action in pairs(visual_actions) do
    keymap.set(OWNER, 'x', lhs, fold_action(lhs, action), { desc = 'CodeVim: ' .. action .. ' fold' })
  end
  for lhs, dir in pairs(motions) do
    keymap.set(OWNER, { 'n', 'x' }, lhs, motion(lhs, dir), { desc = 'CodeVim: move over VS Code folds' })
  end

  local group = vim.api.nvim_create_augroup('codevim.fold', { clear = true })
  vim.api.nvim_create_autocmd({ 'BufWinEnter', 'WinEnter' }, {
    group = group,
    callback = function()
      update_foldenable(vim.api.nvim_get_current_win())
    end,
  })
  vim.api.nvim_create_autocmd({ 'BufDelete', 'BufWipeout' }, {
    group = group,
    callback = function(ev)
      hidden[ev.buf] = nil
    end,
  })
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    update_foldenable(win)
  end
end

function M.disable()
  keymap.clear(OWNER)
  pcall(vim.api.nvim_del_augroup_by_name, 'codevim.fold')
  hidden = {}
  for _, win in ipairs(vim.api.nvim_list_wins()) do
    vim.api.nvim_set_option_value('foldenable', vim.go.foldenable, { scope = 'local', win = win })
  end
end

return M
