export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
}

export const nullLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Prefixes every message, e.g. `[surface] ...`. */
export function scopedLogger(logger: Logger, scope: string): Logger {
  const p = `[${scope}] `;
  return {
    trace: (m, ...a) => logger.trace(p + m, ...a),
    debug: (m, ...a) => logger.debug(p + m, ...a),
    info: (m, ...a) => logger.info(p + m, ...a),
    warn: (m, ...a) => logger.warn(p + m, ...a),
    error: (m, ...a) => logger.error(typeof m === 'string' ? p + m : m, ...a),
  };
}
