-- Executed by the extension (via nvim_exec_lua) before your init.lua is sourced.
--
-- Modules are registered through package.preload rather than 'runtimepath' because
-- plugin managers such as lazy.nvim reset 'runtimepath' during startup.
local runtime, channel, opts = ...
local lua_dir = runtime .. '/lua'

for path, kind in vim.fs.dir(lua_dir, { depth = 4 }) do
  if kind == 'file' and path:match('%.lua$') then
    local module = path:gsub('%.lua$', ''):gsub('/init$', ''):gsub('/', '.')
    local file = lua_dir .. '/' .. path
    package.preload[module] = function()
      return dofile(file)
    end
  end
end

vim.opt.runtimepath:append(runtime)
require('codevim').setup(channel, opts)
