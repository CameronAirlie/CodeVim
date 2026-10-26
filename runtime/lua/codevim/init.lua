-- CodeVim: the Neovim half of the CodeVim VS Code extension.
--
-- The extension calls `setup()` before your init.lua is sourced, so everything in
-- here (including `require('vscode')`) is available to your config.
local M = {}

M.channel = nil
M.opts = {}

--- True when running inside CodeVim. Handy in configs: `if require('codevim').active() then`.
function M.active()
  return M.channel ~= nil
end

---@param runtime_dir? string CodeVim's runtime directory (for 'runtimepath')
function M.setup(channel, opts, runtime_dir)
  M.channel = channel
  M.opts = opts or {}

  vim.g.codevim = 1
  vim.g.codevim_channel = channel
  if M.opts.vscode_global ~= false then
    -- Lets configs written for vscode-neovim (`if vim.g.vscode then`) work unchanged.
    vim.g.vscode = 1
  end

  -- Buffers that exist before VS Code shows anything (the startup [No Name]) are
  -- never mirrored into VS Code.
  local function ignore_existing_buffers()
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
      if not vim.b[buf].codevim_uri then
        vim.b[buf].codevim_ignore = true
      end
    end
  end
  ignore_existing_buffers()

  require('codevim.buffer').setup()
  require('codevim.state').setup()
  require('codevim.window').setup(M.opts)
  if M.opts.clipboard then
    require('codevim.clipboard').setup()
  end
  if M.opts.notify then
    require('codevim.notify').setup()
  end
  if M.opts.language_features == 'vscode' then
    require('codevim.lsp').setup()
  end

  local group = vim.api.nvim_create_augroup('codevim.init', { clear = true })
  vim.api.nvim_create_autocmd('VimEnter', {
    group = group,
    once = true,
    callback = function()
      -- Live :substitute previews edit the buffer, which would leak into the VS Code
      -- document (and its undo stack), so they are turned off.
      vim.o.inccommand = ''
      -- Visual blocks can extend past the end of shorter lines (VS Code draws the
      -- cells there), unless your config chose its own 'virtualedit'.
      if M.opts.virtualedit_block and vim.o.virtualedit == '' then
        vim.o.virtualedit = 'block'
      end
      -- Plugin managers may have reset 'runtimepath'; :checkhealth codevim needs it.
      if runtime_dir and not vim.tbl_contains(vim.opt.runtimepath:get(), runtime_dir) then
        vim.opt.runtimepath:append(runtime_dir)
      end
      ignore_existing_buffers()
      require('codevim.rpc').notify('ready', {})
    end,
  })
end

return M
