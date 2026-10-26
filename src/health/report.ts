import type { HealthLevel, HealthSection } from './check';

const ICONS: Record<HealthLevel, string> = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' };

function count(sections: readonly HealthSection[], level: HealthLevel): number {
  return sections.reduce((n, s) => n + s.items.filter((i) => i.level === level).length, 0);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Renders a health report as Markdown. */
export function renderHealthReport(sections: readonly HealthSection[], at: Date = new Date()): string {
  const errors = count(sections, 'error');
  const warnings = count(sections, 'warn');
  const summary = errors + warnings === 0 ? '✅ Everything looks good.' : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}.`;
  const out = ['# CodeVim health', '', `_${at.toLocaleString()}_`, '', `**${summary}**`, ''];
  for (const section of sections) {
    out.push(`## ${section.title}`, '');
    for (const item of section.items) {
      out.push(`- ${ICONS[item.level]} ${item.message}`);
      if (item.advice) out.push(`  - _${item.advice}_`);
    }
    out.push('');
  }
  out.push('Neovim-side checks are also available inside Neovim as `:checkhealth codevim`.', '');
  return out.join('\n');
}
