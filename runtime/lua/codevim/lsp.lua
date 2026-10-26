-- Hands language features to VS Code (`codevim.languageFeatures: "vscode"`).
--
-- In documents (normal file buffers, which CodeVim mirrors into VS Code):
--   * Neovim's LSP clients don't start or attach, so VS Code's language servers are
--     the only ones (no duplicate work, diagnostics or edits);
--   * completion plugins are switched off, so only IntelliSense pops up;
--   * vim.lsp.buf.* and vim.diagnostic.* run the matching VS Code commands, so the
--     mappings in your config (and Neovim's defaults: K, grn, grr, ]d…) keep working.
-- Plugin buffers (help, oil, terminals…) are left alone.
local keymap = require('codevim.keymap')

local M = {}

local OWNER = 'lsp'

local function document(buf)
  buf = (buf == nil or buf == 0) and vim.api.nvim_get_current_buf() or buf
  return vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].buftype == '' and not vim.b[buf].codevim_foreign
end

local function action(name, args)
  require('vscode').action(name, args and { args = args } or nil)
end

-- vim.lsp.buf function -> VS Code command.
local buf_commands = {
  hover = 'editor.action.showHover',
  definition = 'editor.action.revealDefinition',
  declaration = 'editor.action.revealDeclaration',
  type_definition = 'editor.action.goToTypeDefinition',
  implementation = 'editor.action.goToImplementation',
  references = 'editor.action.goToReferences',
  rename = 'editor.action.rename',
  code_action = 'editor.action.quickFix',
  signature_help = 'editor.action.triggerParameterHints',
  document_symbol = 'workbench.action.gotoSymbol',
  workspace_symbol = 'workbench.action.showAllSymbols',
  incoming_calls = 'editor.showIncomingCalls',
  outgoing_calls = 'editor.showOutgoingCalls',
  typehierarchy = 'editor.showTypeHierarchy',
}

local function patch_lsp_buf()
  local lsp_buf = require('vim.lsp.buf')
  for fn, command in pairs(buf_commands) do
    local original = lsp_buf[fn]
    lsp_buf[fn] = function(...)
      if document() then
        return action(command)
      end
      if original then
        return original(...)
      end
    end
  end
  local format = lsp_buf.format
  lsp_buf.format = function(opts)
    if not document(opts and opts.bufnr) then
      return format(opts)
    end
    action((opts and opts.range) and 'editor.action.formatSelection' or 'editor.action.formatDocument')
  end
end

local function patch_diagnostic()
  local d = vim.diagnostic
  local function step(count)
    local command = count < 0 and 'editor.action.marker.prev' or 'editor.action.marker.next'
    for _ = 1, math.max(1, math.abs(count)) do
      action(command)
    end
  end
  local wrap = function(name, fn)
    local original = d[name]
    if original then
      d[name] = function(...)
        if document() then
          return fn(...)
        end
        return original(...)
      end
    end
  end
  wrap('jump', function(opts)
    step((opts and opts.count) or 1)
  end)
  wrap('goto_next', function()
    step(1)
  end)
  wrap('goto_prev', function()
    step(-1)
  end)
  wrap('open_float', function()
    action('editor.action.showHover')
  end)
  wrap('setqflist', function()
    action('workbench.actions.view.problems')
  end)
  wrap('setloclist', function()
    action('workbench.actions.view.problems')
  end)
end

--- Turns completion plugins off in a document (blink.cmp, nvim-cmp, mini.completion,
--- the built-in 'autocomplete').
local function disable_completion(buf)
  vim.b[buf].completion = false -- blink.cmp
  vim.b[buf].minicompletion_disable = true
  local cmp = package.loaded['cmp']
  if cmp and cmp.setup and cmp.setup.buffer then
    vim.api.nvim_buf_call(buf, function()
      pcall(cmp.setup.buffer, { enabled = false })
    end)
  end
  if vim.fn.exists('+autocomplete') == 1 then
    vim.bo[buf].autocomplete = false
  end
end

--- Called before your config loads, so wrapped functions are the ones it sees.
function M.setup()
  local start = vim.lsp.start
  vim.lsp.start = function(config, opts)
    if document(opts and opts.bufnr) then
      return nil
    end
    return start(config, opts)
  end
  patch_lsp_buf()
  patch_diagnostic()

  local group = vim.api.nvim_create_augroup('codevim.lsp', { clear = true })
  -- Safety net for plugins that attach clients without vim.lsp.start.
  vim.api.nvim_create_autocmd('LspAttach', {
    group = group,
    callback = function(ev)
      if document(ev.buf) then
        vim.schedule(function()
          pcall(vim.lsp.buf_detach_client, ev.buf, ev.data.client_id)
        end)
      end
    end,
  })
  vim.api.nvim_create_autocmd({ 'BufEnter', 'InsertEnter' }, {
    group = group,
    callback = function(ev)
      if document(ev.buf) then
        disable_completion(ev.buf)
      end
    end,
  })
  -- Keys that only exist once an LSP client attaches: give them VS Code meanings,
  -- unless your config maps them itself.
  vim.api.nvim_create_autocmd('VimEnter', {
    group = group,
    once = true,
    callback = function()
      local keys = { K = 'hover', gd = 'definition', gD = 'declaration' }
      for lhs, fn in pairs(keys) do
        keymap.set(OWNER, 'n', lhs, function()
          if document() then
            vim.lsp.buf[fn]()
          else
            keymap.feed_builtin(lhs) -- e.g. K in a help buffer
          end
        end, { desc = 'CodeVim: VS Code ' .. fn })
      end
    end,
  })
end

return M
