-- `require('vscode')`: call into VS Code from your Neovim config.
--
-- The API mirrors the one provided by vscode-neovim, so existing configs keep
-- working:
--
--   local vscode = require('vscode')
--   vscode.action('editor.action.formatDocument')             -- async
--   local r = vscode.call('workbench.action.files.save')       -- sync, returns result
--   vscode.action('editor.action.addCommentLine', { range = { 3, 10 } })
--   local lines = vscode.eval('return vscode.window.activeTextEditor.document.lineCount')
--   vscode.notify('hello from nvim')
local rpc = require('codevim.rpc')

local M = {}

local callbacks = {}
local next_callback = 1

local function register(cb)
  if type(cb) ~= 'function' then
    return nil
  end
  local id = next_callback
  next_callback = next_callback + 1
  callbacks[id] = cb
  return id
end

--- Called by the extension when an async action finishes.
function M._resolve(id, err, result)
  local cb = callbacks[id]
  callbacks[id] = nil
  if cb then
    cb(err ~= vim.NIL and err or nil, result ~= vim.NIL and result or nil)
  end
end

local function normalize_args(args)
  if args == nil then
    return nil
  end
  if type(args) ~= 'table' or not vim.islist(args) then
    return { args }
  end
  return args
end

-- Accepts {line1, line2}, {l1, c1, l2, c2} (0-based) or an LSP-style range.
local function normalize_range(range)
  if not range then
    return nil
  end
  if range.start then
    return { range.start.line, range.start.character, range['end'].line, range['end'].character }
  end
  return range
end

local function command_payload(name, opts)
  opts = opts or {}
  return {
    name = name,
    args = normalize_args(opts.args),
    range = normalize_range(opts.range),
    restore_selection = opts.restore_selection ~= false,
  }
end

--- Runs a VS Code command asynchronously.
---@param opts? { args?: any, range?: table, restore_selection?: boolean, callback?: fun(err, result) }
function M.action(name, opts)
  local payload = command_payload(name, opts)
  payload.callback = register(opts and opts.callback)
  rpc.notify('action', payload)
end

--- Runs a VS Code command and waits for its result.
function M.call(name, opts, timeout)
  local payload = command_payload(name, opts)
  payload.timeout = timeout
  return rpc.request('call', payload)
end

--- Evaluates JavaScript in the extension host and returns the (JSON-serialisable) result.
--- `vscode` (the VS Code API) and `args` are in scope; `await` is allowed.
function M.eval(code, opts, timeout)
  return rpc.request('eval', { code = code, args = opts and opts.args, timeout = timeout })
end

function M.eval_async(code, opts)
  opts = opts or {}
  rpc.notify('eval_async', { code = code, args = opts.args, callback = register(opts.callback) })
end

--- Shows a VS Code notification. `level` is a vim.log.levels value.
function M.notify(msg, level)
  rpc.notify('notify', { msg = tostring(msg), level = level or vim.log.levels.INFO })
end

function M.has_config(name)
  return rpc.request('has_config', { name = name })
end

function M.get_config(name)
  return rpc.request('get_config', { name = name })
end

--- @param target? 'global'|'workspace'
function M.update_config(name, value, target)
  rpc.notify('update_config', { name = name, value = value, target = target or 'global' })
end

return M
