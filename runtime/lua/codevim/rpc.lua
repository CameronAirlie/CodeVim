-- Messaging between the Neovim runtime and the VS Code extension host.
--
-- Notifications: rpcnotify(channel, "codevim", <event>, <payload>)
-- Requests:      rpcrequest(channel, "codevim_request", <method>, <payload>)
local M = {}

local function channel()
  return require('codevim').channel
end

function M.notify(event, payload)
  local chan = channel()
  if not chan then
    return
  end
  vim.rpcnotify(chan, 'codevim', event, payload or vim.empty_dict())
end

function M.request(method, payload)
  local chan = channel()
  if not chan then
    error('CodeVim: not connected to VS Code')
  end
  return vim.rpcrequest(chan, 'codevim_request', method, payload or vim.empty_dict())
end

return M
