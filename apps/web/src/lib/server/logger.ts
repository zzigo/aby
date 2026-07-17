const levels = ['debug', 'info', 'warn', 'error'] as const;
type Level = typeof levels[number];

const redactPattern = /secret|password|token|authorization|access.?key/i;

function safeValue(key: string, value: unknown): unknown {
  if (redactPattern.test(key)) return '[REDACTED]';
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [nestedKey, safeValue(nestedKey, nestedValue)]));
  }
  return value;
}

export function log(level: Level, event: string, context: Record<string, unknown> = {}): void {
  const threshold = levels.indexOf((process.env.ABY_LOG_LEVEL as Level) || 'info');
  if (levels.indexOf(level) < threshold) return;
  const record = {
    timestamp: new Date().toISOString(), service: 'aby-web', level, event,
    ...Object.fromEntries(Object.entries(context).map(([key, value]) => [key, safeValue(key, value)]))
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

