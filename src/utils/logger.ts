// src/utils/logger.ts -- Logger with verbose/quiet modes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Logger {
  info(message: string): void;
  verbose(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class LoggerImpl implements Logger {
  private verboseEnabled: boolean;

  constructor(options: { verbose: boolean }) {
    this.verboseEnabled = options.verbose;
  }

  /** Always prints to stdout. */
  info(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  /** Only prints when verbose mode is active. Outputs to stdout. */
  verbose(message: string): void {
    if (!this.verboseEnabled) return;
    process.stdout.write(`[VERBOSE] ${message}\n`);
  }

  /** Prints to stderr with [WARN] prefix. */
  warn(message: string): void {
    process.stderr.write(`[WARN] ${message}\n`);
  }

  /** Prints to stderr with [ERROR] prefix. */
  error(message: string): void {
    process.stderr.write(`[ERROR] ${message}\n`);
  }

  /** Prints to stdout with a checkmark prefix. */
  success(message: string): void {
    process.stdout.write(`\u2714 ${message}\n`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Logger instance.
 *
 * @param options.verbose  When true, calls to `verbose()` produce output;
 *                         otherwise they are silently discarded.
 */
export function createLogger(options: { verbose: boolean }): Logger {
  return new LoggerImpl(options);
}
