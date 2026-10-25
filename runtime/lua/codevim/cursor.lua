-- Applies cursor positions and selections coming from VS Code.
-- All incoming columns are UTF-16 (VS Code); they are converted to bytes here.
local util = require('codevim.util')

local M = {}

local function to_byte(buf, line, col16)
  return util.byteindex(util.get_line(buf, line), col16)
end

local function exit_visual()
  if util.is_visual(vim.api.nvim_get_mode().mode) then
    vim.cmd('normal! ' .. util.esc)
  end
end

--- Moves the cursor of the current window (no-op if `buf` is not current).
function M.set_cursor(buf, line, col16)
  if vim.api.nvim_get_current_buf() ~= buf then
    return
  end
  util.internal(function()
    exit_visual()
    local count = vim.api.nvim_buf_line_count(buf)
    line = math.min(line, count - 1)
    pcall(vim.api.nvim_win_set_cursor, 0, { line + 1, to_byte(buf, line, col16) })
  end)
end

--- Starts (or updates) a characterwise visual selection. Both ends are inclusive.
function M.select(buf, sline, scol16, eline, ecol16)
  if vim.api.nvim_get_current_buf() ~= buf then
    return
  end
  local mode = vim.api.nvim_get_mode().mode
  if mode ~= 'n' and not util.is_visual(mode) then
    return
  end
  util.internal(function()
    exit_visual()
    vim.api.nvim_win_set_cursor(0, { sline + 1, to_byte(buf, sline, scol16) })
    vim.cmd('normal! v')
    vim.api.nvim_win_set_cursor(0, { eline + 1, to_byte(buf, eline, ecol16) })
  end)
end

return M
