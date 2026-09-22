/**
 * Safe Structured Logging (ADR-12, SECURITY_PRIVACY.md §20, PI-06)
 * Accepts strictly whitelisted fields only to prevent accidental PII leakage.
 */

export const ALLOWED_LOG_FIELDS = new Set([
  'timestamp',
  'level',
  'module',
  'event',
  'session_id',
  'step_number',
  'action_type',
  'risk_category',
  'error_code',
  'duration_ms',
  'element_id',
  'status',
  'target_url_origin',
  'model_name',
  'sanitized_count',
  'success',
  'reason',
]);

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SafeLogEntry {
  level: LogLevel;
  module: string;
  event: string;
  session_id?: string;
  step_number?: number;
  action_type?: string;
  risk_category?: string;
  error_code?: string;
  duration_ms?: number;
  element_id?: string;
  status?: string;
  target_url_origin?: string;
  model_name?: string;
  sanitized_count?: number;
  success?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export type LogSink = (entry: Record<string, unknown>) => void;

let currentSink: LogSink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === 'error') {
    process.stderr?.write ? process.stderr.write(line + '\n') : console.error(line);
  } else {
    process.stdout?.write ? process.stdout.write(line + '\n') : console.log(line);
  }
};

export function setLogSink(sink: LogSink): void {
  currentSink = sink;
}

export function filterSafeFields(entry: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {
    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(entry)) {
    if (ALLOWED_LOG_FIELDS.has(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

export const slog = {
  log(level: LogLevel, entry: Omit<SafeLogEntry, 'level'>): Record<string, unknown> {
    const raw: Record<string, unknown> = { ...entry, level };
    const safe = filterSafeFields(raw);
    currentSink(safe);
    return safe;
  },

  info(entry: Omit<SafeLogEntry, 'level'>): Record<string, unknown> {
    return slog.log('info', entry);
  },

  warn(entry: Omit<SafeLogEntry, 'level'>): Record<string, unknown> {
    return slog.log('warn', entry);
  },

  error(entry: Omit<SafeLogEntry, 'level'>): Record<string, unknown> {
    return slog.log('error', entry);
  },

  debug(entry: Omit<SafeLogEntry, 'level'>): Record<string, unknown> {
    return slog.log('debug', entry);
  },
};
