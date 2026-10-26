import { HealthCheck, HealthItem } from '../check';

/** Setting values that are ignored or easy to get wrong. */
export const settingsCheck: HealthCheck = {
  title: 'Settings',
  run({ config }) {
    const cfg = config.current;
    const items: HealthItem[] = [];
    if (cfg.insertEscapeSequence && cfg.insertEscapeSequence.length !== 2) {
      items.push({
        level: 'warn',
        message: `\`codevim.insert.escapeSequence\` is "${cfg.insertEscapeSequence}" and is ignored.`,
        advice: 'Use exactly two characters, e.g. "jk".',
      });
    }
    if (!cfg.documentSchemes.includes('file')) {
      items.push({ level: 'warn', message: '`codevim.documentSchemes` does not include "file", so files on disk are not mirrored.' });
    }
    if (cfg.insertStrategy === 'neovim') {
      items.push({ level: 'info', message: '`codevim.insert.strategy` is "neovim" (experimental).' });
    }
    const disabled = Object.entries(cfg.features)
      .filter(([, on]) => on === false)
      .map(([id]) => id);
    if (disabled.length > 0) {
      items.push({ level: 'info', message: `Disabled features: ${disabled.join(', ')}` });
    }
    if (items.length === 0) {
      items.push({ level: 'ok', message: 'No problems found.' });
    }
    return items;
  },
};
