-- Default keymaps installed by CodeVim features once Neovim has started.
--
-- Features are enabled after your config has loaded, so a key you mapped yourself
-- is left alone (and listed by :checkhealth codevim). Each feature owns its maps
-- and removes them again when it is turned off.
local M = {}

---@type table<string, { mode: string, lhs: string }[]>
local owned = {}
---@type table<string, string[]>
local skipped = {}

--- Maps `lhs` in each of `modes` unless it is already mapped there.
---@param owner string feature that owns the mapping
---@param modes string|string[]
function M.set(owner, modes, lhs, rhs, opts)
  owned[owner] = owned[owner] or {}
  skipped[owner] = skipped[owner] or {}
  for _, mode in ipairs(type(modes) == 'table' and modes or { modes }) do
    if vim.fn.maparg(lhs, mode) ~= '' then
      table.insert(skipped[owner], mode .. ' ' .. lhs)
    else
      vim.keymap.set(mode, lhs, rhs, opts)
      table.insert(owned[owner], { mode = mode, lhs = lhs })
    end
  end
end

--- Removes every mapping `owner` installed.
function M.clear(owner)
  for _, m in ipairs(owned[owner] or {}) do
    pcall(vim.keymap.del, m.mode, m.lhs)
  end
  owned[owner] = nil
  skipped[owner] = nil
end

--- Mappings that were not installed because your config already maps the key.
---@return table<string, string[]>
function M.skipped()
  return skipped
end

--- Runs keys as the built-in command (no remapping), so a mapping can fall back to it.
--- They are inserted before keys that are already typed ahead.
function M.feed_builtin(keys)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(keys, true, false, true), 'ni', false)
end

return M
