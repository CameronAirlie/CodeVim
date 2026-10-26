-- Small helpers shared by the CodeVim runtime modules.
local M = {}

local is_windows = vim.fn.has('win32') == 1
local has_011 = vim.fn.has('nvim-0.11') == 1

--- Normalises a path for comparisons (symlinks, slashes, and case on Windows).
--- Symlinks matter: on macOS the temp dir /var/… is really /private/var/…, and a
--- project opened through a symlink must still match its buffer.
function M.normalize_path(path)
  if not path or path == '' then
    return ''
  end
  local real = vim.uv.fs_realpath(path)
  if not real then
    -- Not on disk yet (a new file): resolve the folder it goes in.
    local dir = vim.uv.fs_realpath(vim.fs.dirname(path))
    real = dir and (dir .. '/' .. vim.fs.basename(path))
  end
  local p = vim.fs.normalize(real or path)
  if is_windows then
    p = p:lower()
  end
  return p
end

--- Number of UTF-16 code units in `s`.
function M.utf16_len(s)
  if has_011 then
    return vim.str_utfindex(s, 'utf-16')
  end
  local _, u16 = vim.str_utfindex(s)
  return u16
end

--- Converts a UTF-16 column (what VS Code uses) into a byte column, clamped to the line.
function M.byteindex(s, col16)
  if col16 <= 0 then
    return 0
  end
  if col16 >= M.utf16_len(s) then
    return #s
  end
  if has_011 then
    return vim.str_byteindex(s, 'utf-16', col16, false)
  end
  local ok, b = pcall(vim.str_byteindex, s, col16, true)
  return ok and b or #s
end

function M.get_line(buf, line)
  return vim.api.nvim_buf_get_lines(buf, line, line + 1, false)[1] or ''
end

local internal_depth = 0

--- Runs `fn` while marking state changes as caused by the extension itself, so the
--- reporter can tell VS Code not to react to them (avoids feedback loops).
function M.internal(fn, ...)
  internal_depth = internal_depth + 1
  local ok, a, b = pcall(fn, ...)
  internal_depth = internal_depth - 1
  if not ok then
    error(a, 0)
  end
  return a, b
end

function M.is_internal()
  return internal_depth > 0
end

function M.is_float(win)
  return vim.api.nvim_win_get_config(win or 0).relative ~= ''
end

--- The buffer mirrors a real VS Code document (not a plugin buffer shown as an editor).
function M.is_document(buf)
  buf = buf or vim.api.nvim_get_current_buf()
  return vim.b[buf].codevim_uri ~= nil and not vim.b[buf].codevim_foreign
end

local visual_modes ={ v = true, V = true, ['\22'] = true }

function M.is_visual(mode)
  return visual_modes[mode:sub(1, 1)] == true
end

M.esc = vim.api.nvim_replace_termcodes('<Esc>', true, false, true)

return M
