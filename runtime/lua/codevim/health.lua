-- Health checks for the Neovim side of CodeVim.
--
--   :checkhealth codevim       inside Neovim
--   "CodeVim: Check Health"    in VS Code (calls report())
local M = {}

---@alias codevim.HealthItem { level: 'ok'|'info'|'warn'|'error', msg: string, advice?: string }

---@return codevim.HealthItem[]
function M.report()
  local items = {}
  local function add(level, msg, advice)
    table.insert(items, { level = level, msg = msg, advice = advice })
  end
  local codevim = require('codevim')

  if codevim.active() then
    add('ok', 'Connected to VS Code on channel ' .. codevim.channel)
  else
    add('error', 'Not connected to VS Code', 'This Neovim was not started by CodeVim.')
  end

  local vimrc = vim.env.MYVIMRC
  if vimrc and vimrc ~= '' then
    add('ok', 'Config: ' .. vimrc)
  else
    add('info', 'No config file was loaded (e.g. running with --clean).')
  end

  if vim.v.errmsg ~= '' then
    add('warn', 'Last error message: ' .. vim.v.errmsg, 'Run :messages (or "CodeVim: Show Neovim Messages") for details.')
  end

  if codevim.opts.clipboard then
    local provider = type(vim.g.clipboard) == 'table' and vim.g.clipboard.name or nil
    if provider == 'codevim' then
      add('ok', 'Clipboard: VS Code clipboard')
    else
      add('info', 'Clipboard: your own provider (' .. tostring(provider or vim.g.clipboard) .. ') is used instead of VS Code\'s.')
    end
  end

  for owner, keys in pairs(require('codevim.keymap').skipped()) do
    if #keys > 0 then
      add(
        'warn',
        ('Your config maps %s, so CodeVim\'s "%s" mappings for them are not installed.'):format(table.concat(keys, ', '), owner),
        'Remove those mappings, or skip them inside CodeVim with `if not vim.g.codevim then … end`.'
      )
    end
  end

  return items
end

--- Entry point for :checkhealth codevim.
function M.check()
  local health = vim.health
  health.start('CodeVim')
  for _, item in ipairs(M.report()) do
    local fn = ({ ok = health.ok, info = health.info, warn = health.warn, error = health.error })[item.level]
    fn(item.msg, item.advice)
  end
end

return M
