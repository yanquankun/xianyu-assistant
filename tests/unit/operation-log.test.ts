import { describe, expect, it } from 'vitest';

import {
  appendOperationLog,
  sanitizeLogEntry,
  type OperationLogEntry
} from '../../src/storage/operation-log';

describe('sanitizeLogEntry', () => {
  it('删除授权头、API Key、Cookie 和 URL 用户信息', () => {
    const sanitized = sanitizeLogEntry({
      id: 'log-1',
      timestamp: '2026-08-31T10:00:00.000Z',
      stage: 'ai',
      outcome: 'failure',
      message:
        'Authorization: Bearer secret-token apiKey=secret-key Cookie: sid=abc https://user:pass@example.com/v1'
    });

    expect(sanitized.message).toBe(
      'Authorization: [已脱敏] apiKey=[已脱敏] Cookie: [已脱敏] https://example.com/v1'
    );
    expect(JSON.stringify(sanitized)).not.toContain('secret-token');
    expect(JSON.stringify(sanitized)).not.toContain('secret-key');
    expect(JSON.stringify(sanitized)).not.toContain('user:pass');
  });
});

describe('appendOperationLog', () => {
  it('超过 100 条时只保留最新记录', () => {
    const existing: OperationLogEntry[] = Array.from({ length: 100 }, (_, index) => ({
      id: `log-${String(index)}`,
      timestamp: `2026-08-31T10:00:${String(index).padStart(2, '0')}.000Z`,
      stage: 'parse',
      outcome: 'success',
      message: `记录 ${String(index)}`
    }));

    const result = appendOperationLog(existing, {
      id: 'log-new',
      timestamp: '2026-08-31T11:00:00.000Z',
      stage: 'fill',
      outcome: 'success',
      message: '最新记录'
    });

    expect(result).toHaveLength(100);
    expect(result.at(0)?.id).toBe('log-1');
    expect(result.at(-1)?.id).toBe('log-new');
  });

  it('添加记录时不会修改原数组', () => {
    const existing: OperationLogEntry[] = [];

    const result = appendOperationLog(existing, {
      id: 'log-new',
      timestamp: '2026-08-31T11:00:00.000Z',
      stage: 'fill',
      outcome: 'success',
      message: '完成'
    });

    expect(existing).toEqual([]);
    expect(result).toHaveLength(1);
  });
});
