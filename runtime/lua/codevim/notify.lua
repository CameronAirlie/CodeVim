-- Routes vim.notify() to VS Code notifications.
local rpc = require('codevim.rpc')

local M = {}

function M.setup()
  vim.notify = function(msg, level, _)
    rpc.notify('notify', { msg = tostring(msg), level = level or vim.log.levels.INFO })
  end
end

return M
