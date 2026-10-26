-- Jumps made in VS Code (Go to Definition, Go to Line, outline, search results…)
-- recorded in Neovim's jumplist, so <C-o>/<C-i> (and VS Code's Go Back/Forward,
-- which CodeVim routes to them) return there.
local util = require('codevim.util')

local M = {}

local function position(buf, line, col16)
  line = math.max(0, math.min(line, vim.api.nvim_buf_line_count(buf) - 1))
  return { line + 1, util.byteindex(util.get_line(buf, line), col16) }
end

--- Adds `from` to the jumplist and moves the cursor to `to` (UTF-16 columns).
function M.record(buf, from_line, from_col16, to_line, to_col16)
  if vim.api.nvim_get_current_buf() ~= buf or util.is_float(0) then
    return
  end
  util.internal(function()
    pcall(vim.api.nvim_win_set_cursor, 0, position(buf, from_line, from_col16))
    vim.cmd("normal! m'")
    pcall(vim.api.nvim_win_set_cursor, 0, position(buf, to_line, to_col16))
  end)
end

return M
