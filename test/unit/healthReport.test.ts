import { describe, expect, it } from 'vitest';
import { renderHealthReport } from '../../src/health/report';

describe('renderHealthReport', () => {
  it('summarises a clean report', () => {
    const md = renderHealthReport([{ title: 'Neovim', items: [{ level: 'ok', message: 'NVIM v0.11.1' }] }]);
    expect(md).toContain('# CodeVim health');
    expect(md).toContain('Everything looks good');
    expect(md).toContain('## Neovim\n\n- ✅ NVIM v0.11.1');
  });

  it('counts problems and shows advice under the item', () => {
    const md = renderHealthReport([
      { title: 'A', items: [{ level: 'error', message: 'broken', advice: 'fix it' }] },
      { title: 'B', items: [{ level: 'warn', message: 'odd' }, { level: 'warn', message: 'odder' }, { level: 'info', message: 'fyi' }] },
    ]);
    expect(md).toContain('**1 error, 2 warnings.**');
    expect(md).toContain('- ❌ broken\n  - _fix it_');
    expect(md).toContain('- ℹ️ fyi');
  });
});
