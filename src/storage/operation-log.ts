export type OperationStage = 'parse' | 'permission' | 'ai' | 'login' | 'fill' | 'system';

export type OperationOutcome = 'success' | 'failure' | 'warning';

export interface OperationLogEntry {
  id: string;
  timestamp: string;
  stage: OperationStage;
  outcome: OperationOutcome;
  message: string;
  code?: string;
}

const MAX_LOG_ENTRIES = 100;

function redactUrlCredentials(message: string): string {
  return message.replace(/\bhttps?:\/\/[^\s]+/giu, (candidate) => {
    try {
      const url = new URL(candidate);
      url.username = '';
      url.password = '';
      return url.href;
    } catch {
      return candidate;
    }
  });
}

export function sanitizeLogEntry(entry: OperationLogEntry): OperationLogEntry {
  const message = redactUrlCredentials(entry.message)
    .replace(/Authorization:\s*Bearer\s+\S+/giu, 'Authorization: [已脱敏]')
    .replace(/apiKey\s*=\s*\S+/giu, 'apiKey=[已脱敏]')
    .replace(/Cookie:\s*\S+/giu, 'Cookie: [已脱敏]');

  return { ...entry, message };
}

export function appendOperationLog(
  existing: readonly OperationLogEntry[],
  entry: OperationLogEntry
): OperationLogEntry[] {
  return [...existing, sanitizeLogEntry(entry)].slice(-MAX_LOG_ENTRIES);
}
