-- Reports editor state to VS Code: mode, cursor/selection, the current window
-- (and whether it shows a mirrored document), viewport and search matches.
--
-- Payloads only use plain data. Columns are byte offsets; the extension converts
-- them using its copy of the text.
local rpc = require('codevim.rpc')
local util = require('codevim.util')

local M = {}

local last = {
  window = nil,
  viewport = { win = -1, buf = -1, top = -1 },
  search_key = nil,
}

local function block_ranges()
  if vim.fn.exists('*getregionpos') == 0 then
    return nil
  end
  local ok, region = pcall(vim.fn.getregionpos, vim.fn.getpos('v'), vim.fn.getpos('.'), { type = '\22' })
  if not ok then
    return nil
  end
  local ranges = {}
  for _, r in ipairs(region) do
    local s, e = r[1], r[2]
    -- [line, start byte, end byte (exclusive)]
    table.insert(ranges, { s[2] - 1, s[3] - 1, e[3] })
  end
  return ranges
end

function M.cursor_payload(mode)
  mode = mode or vim.api.nvim_get_mode().mode
  local pos = vim.api.nvim_win_get_cursor(0)
  local p = { buf = vim.api.nvim_get_current_buf(), line = pos[1] - 1, col = pos[2], mode = mode }
  if util.is_visual(mode) then
    local v = vim.fn.getpos('v')
    p.vline, p.vcol = v[2] - 1, v[3] - 1
    if mode:sub(1, 1) == '\22' then
      p.block = block_ranges()
    end
  end
  return p
end

--- Classifies a buffer so VS Code knows how to present it.
---   bound   - mirrors a VS Code document
---   file    - a real file Neovim opened itself (`:e`, telescope, `gf`): open it in VS Code
---   scratch - an unnamed normal buffer (`:enew`): becomes an untitled VS Code document
---   special - plugin/help/terminal buffers: shown on the Neovim surface
---   ignored - the startup [No Name] buffer
-- Start screens make no sense inside VS Code (it has its own welcome page).
local dashboards = {
  alpha = true,
  dashboard = true,
  snacks_dashboard = true,
  ministarter = true,
  starter = true,
  startify = true,
}

local function classify(buf)
  if vim.b[buf].codevim_uri then
    return 'bound'
  end
  if vim.b[buf].codevim_ignore or dashboards[vim.bo[buf].filetype] then
    return 'ignored'
  end
  local name = vim.api.nvim_buf_get_name(buf)
  if vim.bo[buf].buftype ~= '' then
    return 'special'
  end
  if name == '' then
    return 'scratch'
  end
  if name:match('^%a[%w+.-]+://') or vim.fn.isdirectory(name) == 1 then
    return 'special'
  end
  return 'file'
end

--- Lines of UI that are not part of the main window (statusline, cmdline, tabline).
-- Only fixed rows count: with splits the window is a fraction of the screen, and
-- growing the screen to compensate would grow the split too (a feedback loop).
local function ui_overhead()
  local windows = #vim.tbl_filter(function(w)
    return not util.is_float(w)
  end, vim.api.nvim_tabpage_list_wins(0))
  local tabs = #vim.api.nvim_list_tabpages()
  local statusline = (vim.o.laststatus >= 2 or (vim.o.laststatus == 1 and windows > 1)) and 1 or 0
  local tabline = (vim.o.showtabline == 2 or (vim.o.showtabline == 1 and tabs > 1)) and 1 or 0
  return vim.o.cmdheight + statusline + tabline
end

-- Whether each side of a float border is drawn: top, right, bottom, left.
local function border_sides(border)
  if type(border) ~= 'table' or #border == 0 then
    return 0, 0, 0, 0
  end
  local function has(i)
    local c = border[((i - 1) % #border) + 1]
    if type(c) == 'table' then
      c = c[1]
    end
    return (c and c ~= '') and 1 or 0
  end
  return has(2), has(4), has(6), has(8)
end

--- Screen rectangle of a float, border included (0-based cells).
local function float_rect(w, cfg)
  local pos = vim.api.nvim_win_get_position(w)
  local top, right, bottom, left = border_sides(cfg.border)
  return {
    row = pos[1],
    col = pos[2],
    width = vim.api.nvim_win_get_width(w) + left + right,
    height = vim.api.nvim_win_get_height(w) + top + bottom,
  }
end

function M.window_payload(internal)
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_win_get_buf(win)
  local is_float = util.is_float(win)
  local floats = {}
  local main = win
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local cfg = vim.api.nvim_win_get_config(w)
    if cfg.relative ~= '' then
      if not cfg.hide and vim.fn.win_gettype(w) ~= 'autocmd' then
        local info = float_rect(w, cfg)
        info.win = w
        info.buf = vim.api.nvim_win_get_buf(w)
        info.focusable = cfg.focusable ~= false
        info.zindex = cfg.zindex or 50
        table.insert(floats, info)
      end
    elseif is_float then
      main = w
    end
  end
  return {
    win = win,
    buf = buf,
    kind = classify(buf),
    uri = vim.b[buf].codevim_uri,
    name = vim.api.nvim_buf_get_name(buf),
    buftype = vim.bo[buf].buftype,
    filetype = vim.bo[buf].filetype,
    modifiable = vim.bo[buf].modifiable,
    is_float = is_float,
    floats = floats,
    windows = #vim.tbl_filter(function(w)
      return not util.is_float(w)
    end, vim.api.nvim_tabpage_list_wins(0)),
    number = vim.wo[main].number,
    relativenumber = vim.wo[main].relativenumber,
    overhead = ui_overhead(),
    internal = internal or false,
  }
end

local function report_window(internal)
  -- Temporary autocommand windows (bufload, nvim_buf_call…) are not real UI.
  if vim.fn.win_gettype() == 'autocmd' then
    return
  end
  local p = M.window_payload(internal)
  local cmp = vim.deepcopy(p)
  cmp.internal = nil
  if vim.deep_equal(cmp, last.window) then
    return
  end
  last.window = cmp
  rpc.notify('window', p)
end

local function schedule_window_report()
  local internal = util.is_internal()
  vim.schedule(function()
    report_window(internal)
  end)
end

local function report_viewport()
  local win = vim.api.nvim_get_current_win()
  if util.is_float(win) then
    return
  end
  local buf = vim.api.nvim_win_get_buf(win)
  local top = vim.fn.line('w0') - 1
  local v = last.viewport
  if v.win == win and v.buf == buf and v.top == top then
    return
  end
  last.viewport = { win = win, buf = buf, top = top }
  rpc.notify('viewport', { win = win, buf = buf, top = top, bot = vim.fn.line('w$') - 1 })
end

--- Scrolls the current window so `top` (0-based) is the first visible line.
--- Remembered so the resulting WinScrolled is not echoed back to VS Code.
function M.set_viewport(buf, top)
  local win = vim.api.nvim_get_current_win()
  if util.is_float(win) or vim.api.nvim_win_get_buf(win) ~= buf then
    return
  end
  local count = vim.api.nvim_buf_line_count(buf)
  top = math.max(0, math.min(top, count - 1))
  last.viewport = { win = win, buf = buf, top = top }
  util.internal(function()
    -- Like scrolling in Vim, the cursor is pulled into the new view (respecting
    -- 'scrolloff'), otherwise Neovim would immediately scroll back to it.
    local height = vim.api.nvim_win_get_height(win)
    local so = math.min(vim.wo[win].scrolloff, math.floor((height - 1) / 2))
    local first = top + 1
    local lo = first == 1 and 1 or first + so
    local hi = first + height - 1 >= count and count or first + height - 1 - so
    local cur = vim.api.nvim_win_get_cursor(win)[1]
    local lnum = math.max(lo, math.min(cur, hi))
    vim.fn.winrestview({ topline = first, lnum = lnum })
  end)
  last.viewport.top = vim.fn.line('w0') - 1
end

-- Search highlighting -------------------------------------------------------

local function search_pattern()
  local mode = vim.api.nvim_get_mode().mode
  if mode:sub(1, 1) == 'c' then
    local t = vim.fn.getcmdtype()
    if (t == '/' or t == '?') and vim.o.incsearch then
      return vim.fn.getcmdline(), true
    end
    return nil
  end
  if vim.v.hlsearch == 1 and vim.o.hlsearch then
    return vim.fn.getreg('/'), false
  end
end

local function find_matches(buf, pattern, top, bot)
  if vim.o.ignorecase and vim.o.smartcase and pattern:find('%u') and not pattern:find('\\c') then
    pattern = '\\C' .. pattern
  end
  local matches = {}
  if vim.fn.exists('*matchbufline') == 1 then
    local ok, res = pcall(vim.fn.matchbufline, buf, pattern, top, bot)
    if ok then
      for i, m in ipairs(res) do
        if i > 2000 then
          break
        end
        table.insert(matches, { m.lnum - 1, m.byteidx, m.byteidx + #m.text })
      end
    end
  end
  return matches
end

local function report_search()
  local win = vim.api.nvim_get_current_win()
  if util.is_float(win) then
    return
  end
  local buf = vim.api.nvim_win_get_buf(win)
  local pattern, incsearch = search_pattern()
  local top = math.max(1, vim.fn.line('w0') - 100)
  local bot = math.min(vim.fn.line('$'), vim.fn.line('w$') + 100)
  local key = table.concat({ buf, tostring(pattern), top, bot, vim.b[buf].changedtick, tostring(incsearch) }, '\0')
  if key == last.search_key then
    return
  end
  last.search_key = key
  local payload = { buf = buf, matches = {} }
  if pattern and pattern ~= '' then
    payload.matches = find_matches(buf, pattern, top, bot)
    if incsearch then
      local flags = vim.fn.getcmdtype() == '?' and 'bnc' or 'nc'
      local ok, pos = pcall(vim.fn.searchpos, pattern, flags)
      if ok and pos[1] > 0 then
        payload.current = { pos[1] - 1, pos[2] - 1 }
      end
    end
  end
  rpc.notify('hlsearch', payload)
end

function M.setup()
  local group = vim.api.nvim_create_augroup('codevim.state', { clear = true })
  local au = function(events, cb)
    vim.api.nvim_create_autocmd(events, { group = group, callback = cb })
  end

  au({ 'CursorMoved', 'CursorMovedI' }, function()
    rpc.notify('cursor', M.cursor_payload())
  end)

  au('ModeChanged', function()
    local new = vim.v.event.new_mode
    local payload = { mode = new, old = vim.v.event.old_mode, internal = util.is_internal() }
    -- Cmdline/operator-pending modes don't move the cursor; only send it when useful.
    if new:sub(1, 1) ~= 'c' then
      payload.cursor = M.cursor_payload(new)
    end
    rpc.notify('mode', payload)
  end)

  -- Floats are drawn opaque in VS Code. With 'winblend' Neovim mixes the (hidden)
  -- text behind a float into its cells, which would show through as dim text.
  au({ 'WinNew', 'OptionSet', 'SafeState' }, function()
    for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
      if util.is_float(w) and vim.wo[w].winblend ~= 0 then
        vim.wo[w].winblend = 0
      end
    end
  end)

  au('WinScrolled', report_viewport)
  au({ 'BufEnter', 'WinEnter', 'BufWinEnter', 'WinNew', 'WinClosed', 'TermOpen', 'FileType', 'OptionSet' }, schedule_window_report)
  au({ 'BufEnter', 'WinEnter' }, function()
    report_window(util.is_internal())
    report_viewport()
  end)
  au('SafeState', function()
    report_window(false)
    report_search()
  end)
  au('CmdlineChanged', report_search)
  au('CmdlineLeave', function()
    vim.schedule(report_search)
  end)
end

--- Forces the next reports to be sent even if nothing changed (used after reconnects).
function M.reset()
  last.window = nil
  last.viewport = { win = -1, buf = -1, top = -1 }
  last.search_key = nil
end

return M
