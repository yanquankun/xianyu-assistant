import { describe, expect, it } from 'vitest';

import {
  appendOperationLog,
  parseOperationLogEntry,
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

  it('递归清洗详情中的凭据并丢弃非日志字段', () => {
    const unsafeFields = {
      settings: { apiKey: 'settings-secret' },
      assetId: 'asset-secret',
      objectUrl: 'blob:https://example.com/object',
      html: '<html>private html</html>'
    };
    const sanitized = sanitizeLogEntry({
      id: 'log-2',
      timestamp: '2026-08-31T10:00:00.000Z',
      stage: 'ai',
      outcome: 'failure',
      message: '扩写失败',
      displayTitle: 'Authorization: Bearer title-secret',
      operationLabel: 'AI 扩写',
      details: {
        result: 'Cookie: sid=detail-secret',
        error: 'apiKey=error-secret',
        warnings: ['https://user:pass@example.com/item', 'Bearer warning-secret'],
        draft: {
          sourceUrl: 'https://user:pass@example.com/item',
          canonicalUrl: 'https://user:pass@example.com/final',
          title: '标题',
          description: '描述',
          selectedImageCount: 1,
          videoName: 'video.mp4'
        }
      },
      ...unsafeFields
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toMatch(
      /title-secret|detail-secret|error-secret|warning-secret|settings-secret|asset-secret|blob:|<html|user:pass/u
    );
    expect(sanitized.details?.draft?.sourceUrl).toBe('https://example.com/item');
    expect(sanitized.details?.draft?.canonicalUrl).toBe('https://example.com/final');
  });

  it('旧日志缺少规范 URL 时继续兼容', () => {
    const entry = parseOperationLogEntry({
      id: 'old-dual-url-log',
      timestamp: '2026-08-31T13:00:00.000Z',
      stage: 'parse',
      outcome: 'success',
      message: '旧版解析完成',
      details: { draft: { sourceUrl: 'https://item.jd.com/1.html', title: '旧商品' } }
    });

    expect(entry?.details?.draft).toEqual({
      sourceUrl: 'https://item.jd.com/1.html',
      title: '旧商品'
    });
  });

  it('保留旧版最小记录并丢弃格式无效的详情', () => {
    const oldEntry = {
      id: 'old-log',
      timestamp: '2026-08-31T13:00:00.000Z',
      stage: 'parse',
      outcome: 'success',
      message: '旧版解析完成'
    };

    expect(parseOperationLogEntry(oldEntry)).toEqual(oldEntry);
    expect(
      parseOperationLogEntry({
        ...oldEntry,
        details: { draft: { sourceUrl: 'javascript:alert(1)' } }
      })
    ).toEqual(oldEntry);
  });

  it('在错误文本中排除媒体对象地址、本地路径和资源标识', () => {
    const sanitized = sanitizeLogEntry({
      id: 'log-3',
      timestamp: '2026-08-31T14:00:00.000Z',
      stage: 'fill',
      outcome: 'failure',
      message: '图片预览失败：blob:https://extension.example/object',
      details: {
        error: 'assetId=asset-secret，authToken=auth-secret，文件位于 /Users/mint/private-image.png',
        result: 'data:image/png;base64,cHJpdmF0ZS1iaW5hcnk=',
        warnings: ['authToken=auth-secret']
      }
    });

    expect(JSON.stringify(sanitized)).not.toMatch(
      /blob:|asset-secret|auth-secret|\/Users\/mint|data:image|cHJpdmF0ZS1iaW5hcnk/u
    );
  });

  it('防御清理警告中裸露的 local UUID 和 assetId', () => {
    const assetId = '8f14e45f-ea47-4b3f-a30b-9f12e7d6c421';
    const sanitized = sanitizeLogEntry({
      id: 'log-raw-media-id',
      timestamp: '2026-08-31T14:00:00.000Z',
      stage: 'fill',
      outcome: 'warning',
      message: '图片处理完成',
      details: {
        warnings: [
          `local-${assetId}：本地图片不存在`,
          `asset-${assetId}：读取失败`
        ]
      }
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(assetId);
    expect(serialized).not.toContain(`local-${assetId}`);
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
