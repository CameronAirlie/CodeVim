-- Document <-> buffer binding: creates the Neovim buffer that mirrors a VS Code
-- document, applies VS Code edits to it, and routes :write back to VS Code.
local rpc = require('codevim.rpc')
local util = require('codevim.util')

local M = {}

local group

-- VS Code language ids that differ from Neovim filetypes.
local language_to_filetype = {
  shellscript = 'sh',
  csharp = 'cs',
  plaintext = 'text',
  ['objective-c'] = 'objc',
  ['objective-cpp'] = 'objcpp',
  makefile = 'make',
  ['git-commit'] = 'gitcommit',
  ['git-rebase'] = 'gitrebase',
  javascriptreact = 'javascriptreact',
  typescriptreact = 'typescriptreact',
  dockercompose = 'yaml.docker-compose',
}

local function find_buffer_by_path(path)
  local target = util.normalize_path(path)
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    local name = vim.api.nvim_buf_get_name(buf)
    if name ~= '' and util.normalize_path(name) == target then
      return buf
    end
  end
end

local function set_name(buf, name)
  if pcall(vim.api.nvim_buf_set_name, buf, name) then
    return
  end
  -- Another buffer already owns that name; disambiguate rather than fail.
  for i = 2, 100 do
    if pcall(vim.api.nvim_buf_set_name, buf, name .. ' (' .. i .. ')') then
      return
    end
  end
end

-- Cursor/view of every window showing `buf`, so a full content reset doesn't lose them.
local function save_views(buf)
  local views = {}
  for _, win in ipairs(vim.fn.win_findbuf(buf)) do
    views[win] = vim.api.nvim_win_get_cursor(win)
  end
  return views
end

local function restore_views(buf, views)
  local count = vim.api.nvim_buf_line_count(buf)
  for win, pos in pairs(views) do
    if vim.api.nvim_win_is_valid(win) then
      pcall(vim.api.nvim_win_set_cursor, win, { math.min(pos[1], count), pos[2] })
    end
  end
end

local function replace_lines(buf, lines)
  local views = save_views(buf)
  -- Loading content must not be undoable, otherwise `u` would empty the file.
  vim.bo[buf].undolevels = -1
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].undolevels = -123456 -- use the global value again
  restore_views(buf, views)
end

local function detect_filetype(buf, name, language_id)
  local ft = vim.filetype.match({ buf = buf, filename = name })
  if not ft or ft == '' then
    ft = language_to_filetype[language_id] or language_id
  end
  if ft and ft ~= '' and vim.bo[buf].filetype ~= ft then
    vim.bo[buf].filetype = ft
  end
end

local function on_write(ev)
  local buf = ev.buf
  local uri = vim.b[buf].codevim_uri
  local target = vim.fn.fnamemodify(ev.match, ':p')
  local own = vim.api.nvim_buf_get_name(buf)
  if uri and util.normalize_path(target) == util.normalize_path(own) then
    local ok, saved = pcall(rpc.request, 'save', { buf = buf, uri = uri })
    if ok and saved ~= false then
      vim.bo[buf].modified = false
    else
      vim.notify('CodeVim: VS Code could not save ' .. own, vim.log.levels.ERROR)
    end
    return
  end
  -- `:w other.txt` or `:'<,'>w part.txt`: write the requested lines ourselves.
  local first, last = vim.fn.line("'["), vim.fn.line("']")
  local lines = vim.api.nvim_buf_get_lines(buf, first - 1, last, false)
  vim.fn.writefile(lines, target)
end

local function setup_buffer_autocmds(buf)
  if vim.b[buf].codevim_autocmds then
    return
  end
  vim.b[buf].codevim_autocmds = true
  vim.api.nvim_create_autocmd('BufWriteCmd', { group = group, buffer = buf, callback = on_write })
  -- VS Code owns the file on disk; never prompt about it changing underneath us.
  vim.api.nvim_create_autocmd('FileChangedShell', {
    group = group,
    buffer = buf,
    callback = function()
      vim.v.fcs_choice = ''
    end,
  })
end

local function fire_read_autocmds(buf, event)
  -- Lets plugins that attach on BufRead (gitsigns, treesitter, lazy-loaded specs) work.
  vim.api.nvim_buf_call(buf, function()
    pcall(vim.api.nvim_exec_autocmds, event, { buffer = buf, modeline = false })
  end)
end

--- Creates (or adopts) the buffer for a VS Code document.
---@param p table { uri, name, path?, buf?, lines, language_id, dirty, readonly, tab_size?, insert_spaces?, read_autocmds?, foreign? }
---@return integer buf
function M.attach(p)
  local buf = p.buf
  if buf and not vim.api.nvim_buf_is_valid(buf) then
    buf = nil
  end
  if p.foreign then
    -- A plugin/help/terminal buffer shown as a VS Code editor. The plugin owns it
    -- (name, options, BufWriteCmd…); only mark it as mirrored.
    if not buf then
      error('CodeVim: plugin buffer no longer exists')
    end
    util.internal(function()
      vim.b[buf].codevim_uri = p.uri
      vim.b[buf].codevim_foreign = true
    end)
    return buf
  end
  if not buf and p.path then
    buf = find_buffer_by_path(p.path)
  end
  local created = buf == nil
  local loaded_from_disk = false
  if created and p.path and vim.uv.fs_stat(p.path) then
    -- Load existing files the normal way: the buffer then counts as "edited" (so
    -- :w is not refused with E13) and BufRead*/FileType autocmds fire naturally.
    buf = vim.fn.bufadd(p.path)
    util.internal(function()
      vim.cmd(('silent noswapfile call bufload(%d)'):format(buf))
    end)
    loaded_from_disk = true
  elseif created then
    buf = vim.api.nvim_create_buf(true, false)
  end
  local fire_autocmds = p.read_autocmds and created and not loaded_from_disk

  util.internal(function()
    if vim.api.nvim_buf_get_name(buf) == '' then
      set_name(buf, p.name)
    end
    local bo = vim.bo[buf]
    bo.swapfile = false
    bo.buflisted = true
    if fire_autocmds then
      fire_read_autocmds(buf, 'BufReadPre')
    end
    if not vim.deep_equal(vim.api.nvim_buf_get_lines(buf, 0, -1, false), p.lines) then
      replace_lines(buf, p.lines)
    end
    vim.b[buf].codevim_uri = p.uri
    vim.b[buf].codevim_ignore = nil
    setup_buffer_autocmds(buf)
    if fire_autocmds then
      fire_read_autocmds(buf, 'BufReadPost')
    end
    if bo.filetype == '' then
      detect_filetype(buf, p.name, p.language_id)
    end
    if p.tab_size then
      bo.tabstop = p.tab_size
      bo.shiftwidth = p.tab_size
      bo.expandtab = p.insert_spaces and true or false
    end
    bo.readonly = p.readonly and true or false
    bo.modified = p.dirty and true or false
  end)
  return buf
end

--- Stops mirroring a document; the buffer is wiped unless it is still shown elsewhere.
function M.detach(buf)
  if not vim.api.nvim_buf_is_valid(buf) then
    return
  end
  util.internal(function()
    if vim.b[buf].codevim_foreign then
      -- Closing a plugin buffer's editor closes its Neovim window too, so it is
      -- not immediately shown (and reopened in VS Code) again.
      for _, win in ipairs(vim.fn.win_findbuf(buf)) do
        local normal_windows = #vim.tbl_filter(function(w)
          return not util.is_float(w)
        end, vim.api.nvim_tabpage_list_wins(0))
        if util.is_float(win) or normal_windows > 1 then
          pcall(vim.api.nvim_win_close, win, true)
        else
          vim.api.nvim_win_call(win, require('codevim.window').leave_special)
        end
      end
    end
    vim.b[buf].codevim_uri = nil
    pcall(vim.api.nvim_buf_delete, buf, { force = true })
  end)
end

--- Replaces the whole buffer (used when re-synchronising from VS Code).
function M.set_content(buf, lines)
  if not vim.api.nvim_buf_is_valid(buf) then
    return false
  end
  util.internal(replace_lines, buf, lines)
  return true
end

--- Applies VS Code content changes. Positions are 0-based with UTF-16 columns and
--- the list is sorted from the end of the document towards the start.
---@param edits table[] { start_line, start_col16, end_line, end_col16, text }
---@param join boolean merge into the previous undo step (one insert session = one undo)
function M.apply_edits(buf, edits, join)
  if not vim.api.nvim_buf_is_valid(buf) then
    return false
  end
  util.internal(function()
    vim.api.nvim_buf_call(buf, function()
      if join then
        pcall(vim.cmd, 'undojoin')
      end
      for _, e in ipairs(edits) do
        local count = vim.api.nvim_buf_line_count(buf)
        local sl, el = math.min(e[1], count - 1), math.min(e[3], count - 1)
        local sline = util.get_line(buf, sl)
        local eline = el == sl and sline or util.get_line(buf, el)
        local sb = e[1] >= count and #sline or util.byteindex(sline, e[2])
        local eb = e[3] >= count and #eline or util.byteindex(eline, e[4])
        vim.api.nvim_buf_set_text(buf, sl, sb, el, eb, vim.split(e[5], '\n', { plain = true }))
      end
    end)
  end)
  return true
end

--- Leaves insert mode after an insert session that VS Code handled.
---
--- When the session was plain typing on one line, the typed text is removed and
--- re-typed through Neovim's input queue so it lands in the redo buffer: this is
--- what makes `.` repeat the insert.
---@param p table { buf, line, col16, replay?: { line, col16, text } }
function M.escape(p)
  local buf = p.buf
  if vim.api.nvim_get_current_buf() ~= buf then
    vim.api.nvim_feedkeys(util.esc, 'n', false)
    return
  end
  util.internal(function()
    local r = p.replay
    if r and r.text ~= '' and vim.fn.mode() == 'i' then
      local line = util.get_line(buf, r.line)
      local sb = util.byteindex(line, r.col16)
      if line:sub(sb + 1, sb + #r.text) == r.text then
        pcall(vim.cmd, 'undojoin')
        vim.api.nvim_buf_set_text(buf, r.line, sb, r.line, sb + #r.text, { '' })
        vim.api.nvim_win_set_cursor(0, { r.line + 1, sb })
        vim.api.nvim_feedkeys(r.text, 'n', false)
        vim.api.nvim_feedkeys(util.esc, 'n', false)
        return
      end
    end
    local line = util.get_line(buf, p.line)
    pcall(vim.api.nvim_win_set_cursor, 0, { p.line + 1, util.byteindex(line, p.col16) })
    vim.api.nvim_feedkeys(util.esc, 'n', false)
  end)
end

function M.setup()
  group = vim.api.nvim_create_augroup('codevim.buffer', { clear = true })
  -- `:bd` / `:bw` on a mirrored buffer closes the VS Code editor too.
  vim.api.nvim_create_autocmd({ 'BufDelete', 'BufWipeout' }, {
    group = group,
    callback = function(ev)
      local uri = vim.b[ev.buf].codevim_uri
      if uri and not util.is_internal() then
        require('codevim.rpc').notify('buf_deleted', { buf = ev.buf, uri = uri })
      end
    end,
  })
end

return M
