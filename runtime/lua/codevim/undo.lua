-- Undo/redo requested by VS Code (Edit menu, other extensions) for a mirrored buffer.
-- Neovim's undo tree is the history of record; the extension then makes the
-- document match the buffer again.
local M = {}

---@param redo boolean
function M.run(buf, redo)
  if not vim.api.nvim_buf_is_valid(buf) then
    return false
  end
  vim.api.nvim_buf_call(buf, function()
    pcall(vim.cmd, redo and 'silent redo' or 'silent undo')
  end)
  return true
end

return M
