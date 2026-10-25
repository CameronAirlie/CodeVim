-- Clipboard provider backed by the VS Code clipboard, so "+y / "+p work without
-- installing win32yank/xclip/pbcopy and behave exactly like VS Code's copy/paste.
local rpc = require('codevim.rpc')

local M = {}

local function copy(lines, regtype)
  rpc.notify('clipboard_set', { lines = lines, regtype = regtype })
end

local function paste()
  local ok, res = pcall(rpc.request, 'clipboard_get', {})
  if not ok or type(res) ~= 'table' then
    return { {}, 'v' }
  end
  return { res.lines, res.regtype }
end

function M.setup()
  if vim.g.clipboard ~= nil then
    return -- respect an explicitly configured provider
  end
  vim.g.clipboard = {
    name = 'codevim',
    copy = { ['+'] = copy, ['*'] = copy },
    paste = { ['+'] = paste, ['*'] = paste },
    cache_enabled = 0,
  }
end

return M
