// End-to-end checks run inside VS Code (loaded by @vscode/test-electron).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeout = 5000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

const type = async (text) => {
  for (const ch of text) {
    await vscode.commands.executeCommand('type', { text: ch });
  }
};
const send = (key) => vscode.commands.executeCommand('codevim.send', key);
const escape = () => vscode.commands.executeCommand('codevim.escape');
const editor = () => vscode.window.activeTextEditor;
const text = () => editor().document.getText().replace(/\r\n/g, '\n');

async function openFile(name, content) {
  const file = path.join(process.env.CODEVIM_E2E_WORKSPACE, name);
  fs.writeFileSync(file, content);
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc, { preview: false });
  await sleep(400); // binding + focus
  return { doc, file };
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(`  ok   ${name}`);
  } catch (err) {
    results.push(`  FAIL ${name}: ${err && err.stack ? err.stack : err}`);
  }
}

async function run() {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'codevim');
  assert.ok(ext, 'extension not found');
  await ext.activate();
  // Wait for Neovim to start and the first document to be mirrored.
  await openFile('warmup.txt', 'warmup\n');
  await until('CodeVim to handle keys', async () => {
    await type('x');
    await sleep(200);
    return text() !== 'warmup\n';
  }, 20000);

  await test('normal-mode edits (dd, x, u)', async () => {
    await openFile('edit.txt', 'one\ntwo\nthree\n');
    await type('jdd');
    await until('dd', () => text() === 'one\nthree\n');
    await type('x');
    await until('x', () => text() === 'one\nhree\n');
    await type('u');
    await until('undo', () => text() === 'one\nthree\n');
  });

  await test('cursor follows Neovim motions', async () => {
    await openFile('cursor.txt', 'a\nb\nc\nd\n');
    await type('G');
    await until('G', () => editor().selection.active.line === 4);
    await type('gg');
    await until('gg', () => editor().selection.active.line === 0);
  });

  await test('insert mode typed in VS Code, synced, and repeatable with .', async () => {
    await openFile('insert.txt', 'abc\nabc\n');
    await type('i');
    await sleep(150);
    await type('XY');
    await escape();
    await until('insert', () => text() === 'XYabc\nabc\n');
    await sleep(200);
    await type('j0.');
    await until('dot repeat', () => text() === 'XYabc\nXYabc\n');
  });

  await test('visual line selection is shown and deletable', async () => {
    await openFile('visual.txt', '1\n2\n3\n4\n');
    await type('Vj');
    await until('selection', () => !editor().selection.isEmpty && editor().selection.end.line === 1);
    await type('d');
    await until('visual delete', () => text() === '3\n4\n');
  });

  await test('VS Code selection becomes visual mode', async () => {
    await openFile('vsel.txt', 'hello world\n');
    editor().selection = new vscode.Selection(0, 6, 0, 11);
    await sleep(200);
    await type('d');
    await until('delete selection', () => text() === 'hello \n');
  });

  await test(':w saves through VS Code', async () => {
    const { doc } = await openFile('save.txt', 'x\n');
    await type('dd');
    await until('dirty', () => doc.isDirty);
    await type(':w');
    await send('<CR>');
    await until('saved', () => !doc.isDirty);
  });

  await test(':e opens the file in VS Code', async () => {
    await openFile('from.txt', 'from\n');
    const target = path.join(process.env.CODEVIM_E2E_WORKSPACE, 'target.txt');
    fs.writeFileSync(target, 'target file\n');
    await type(`:e ${target.replace(/\\/g, '/')}`);
    await send('<CR>');
    await until('target editor', () => editor() && path.basename(editor().document.fileName) === 'target.txt');
  });

  await test('<C-^> switches back to the alternate file', async () => {
    await send('<C-^>');
    await until('alternate editor', () => editor() && path.basename(editor().document.fileName) === 'from.txt');
  });

  await test('<C-w>v splits the editor', async () => {
    const before = vscode.window.tabGroups.all.length;
    await send('<C-w>');
    await type('v');
    await until('split', () => vscode.window.tabGroups.all.length === before + 1);
    await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  });

  const webviewOpen = () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputWebview));
  const pluginTab = (filter = () => true) =>
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.input instanceof vscode.TabInputText && t.input.uri.scheme === 'codevim-buffer' && filter(t));

  await test(':help opens as a normal VS Code editor, :q closes it', async () => {
    await openFile('help.txt', 'file\n');
    await type(':help');
    await send('<CR>');
    await until('help editor', () => {
      if (editor() && editor().document.uri.scheme === 'codevim-buffer' && /help\.txt/.test(text())) return true;
      throw new Error(`active: ${editor() && editor().document.uri.toString()} text: ${editor() && JSON.stringify(text().slice(0, 60))}`);
    });
    assert.ok(!webviewOpen(), 'no Neovim surface tab');
    await type('G');
    await until('cursor moves in help', () => {
      if (editor().selection.active.line > 10) return true;
      throw new Error(`${editor().document.uri} line ${editor().selection.active.line}/${editor().document.lineCount} visible ${vscode.window.visibleTextEditors.map((e) => `${e.document.uri.scheme}:${e.selection.active.line}`)}`);
    });
    await type(':q');
    await send('<CR>');
    await until('help tab closed', () => !pluginTab((t) => t.input.uri.path.endsWith('/help.txt')));
  });

  await test('floating windows stay over the editor and receive keys', async () => {
    const { doc } = await openFile('float.txt', 'under the float\n');
    await type(":lua vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), true, { relative = 'editor', row = 1, col = 2, width = 30, height = 3, border = 'single' })");
    await send('<CR>');
    await sleep(300);
    await type('ihello float');
    await escape();
    await sleep(200);
    await type(":lua require('vscode').eval('globalThis.__codevimFloat = args', { args = vim.api.nvim_buf_get_lines(0, 0, -1, false) })");
    await send('<CR>');
    await until('float content', () => JSON.stringify(globalThis.__codevimFloat) === '["hello float"]');
    assert.strictEqual(editor() && editor().document, doc, `the file editor stays active (active: ${editor() && editor().document.uri})`);
    assert.strictEqual(text(), 'under the float\n', 'typing went to the float, not the file');
    assert.ok(!webviewOpen(), 'no Neovim surface tab');
    await type(':q');
    await send('<CR>');
    await sleep(300);
    await type('x');
    await until('keys reach the file again', () => text() === 'nder the float\n');
  });

  await test("require('vscode') can call VS Code commands", async () => {
    await openFile('bridge.txt', 'bridge\n');
    await type(":lua require('vscode').action('workbench.action.splitEditorRight')");
    const before = vscode.window.tabGroups.all.length;
    await send('<CR>');
    await until('split via lua', () => vscode.window.tabGroups.all.length === before + 1);
    await vscode.commands.executeCommand('workbench.action.joinAllGroups');
  });

  console.log('\nCodeVim e2e results:\n' + results.join('\n') + '\n');
  if (results.some((r) => r.includes('FAIL'))) {
    throw new Error('some e2e tests failed');
  }
}

module.exports = { run };
