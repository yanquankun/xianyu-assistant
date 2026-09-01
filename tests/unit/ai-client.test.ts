import { describe, expect, it, vi } from 'vitest';

import type { ProductDraft } from '../../src/domain/product';
import type { AiSettings } from '../../src/domain/settings';
import { createAiClient, normalizeChatCompletionsUrl } from '../../src/ai/client';

const settings: AiSettings = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'secret-key',
  model: 'gpt-test',
  temperature: 0.3,
  systemInstruction: ''
};

const draft: ProductDraft = {
  id: 'draft-ai',
  platform: 'taobao',
  canonicalUrl: 'https://item.taobao.com/item.htm?id=1',
  source: {
    title: '原始标题',
    description: '原始描述',
    price: 99,
    currency: 'CNY'
  },
  title: '当前标题',
  description: '原始描述',
  price: 99,
  currency: 'CNY',
  images: [],
  videos: [],
  warnings: [],
  confidence: 'high',
  shippingMethod: '包邮',
  categoryNote: '',
  updatedAt: '2026-08-31T10:00:00.000Z'
};

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

describe('normalizeChatCompletionsUrl', () => {
  it('把 v1 Base URL 规范为 Chat Completions 地址', () => {
    expect(normalizeChatCompletionsUrl('https://api.example.com/v1/').href).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('已经是 Chat Completions 地址时不重复追加', () => {
    expect(normalizeChatCompletionsUrl('https://api.example.com/v1/chat/completions').href).toBe(
      'https://api.example.com/v1/chat/completions'
    );
  });

  it('拒绝非 HTTP 接口地址', () => {
    expect(() => normalizeChatCompletionsUrl('file:///tmp/api')).toThrow(
      'AI Base URL 仅支持 HTTP 或 HTTPS'
    );
  });

  it('远程 AI 地址必须使用 HTTPS，但允许本机夹具使用 HTTP', () => {
    expect(() => normalizeChatCompletionsUrl('http://api.example.com/v1')).toThrow(
      '远程 AI Base URL 必须使用 HTTPS'
    );
    expect(normalizeChatCompletionsUrl('http://127.0.0.1:4173/v1').href).toBe(
      'http://127.0.0.1:4173/v1/chat/completions'
    );
    expect(normalizeChatCompletionsUrl('http://localhost:4173/v1').href).toBe(
      'http://localhost:4173/v1/chat/completions'
    );
  });
});

describe('createAiClient', () => {
  it('连接测试不强制启用 JSON mode', async () => {
    let requestBody = '';
    const client = createAiClient((_input, init) => {
      requestBody = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(chatResponse('连接成功'));
    });

    await client.testConnection(settings);

    expect(JSON.parse(requestBody)).not.toHaveProperty('response_format');
  });

  it('使用 Bearer Key 和配置模型发送 OpenAI 兼容请求', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const client = createAiClient((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ url, init: init ?? {} });
      return Promise.resolve(
        chatResponse('{"title":"扩写标题","description":"扩写描述","warnings":[]}')
      );
    });

    const result = await client.expandDraft(settings, draft);

    expect(result.title).toBe('扩写标题');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.example.com/v1/chat/completions');
    expect(requests[0]?.init.headers).toEqual({
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json'
    });
    const requestBody = requests[0]?.init.body;
    if (typeof requestBody !== 'string') {
      throw new Error('测试需要 JSON 字符串请求体');
    }
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body.model).toBe('gpt-test');
    expect(body.temperature).toBe(0.3);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('AI 返回无效 JSON 时保留原草稿', async () => {
    const client = createAiClient(() => Promise.resolve(chatResponse('not-json')));

    await expect(client.expandDraft(settings, draft)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE'
    });
    expect(draft.description).toBe('原始描述');
  });

  it.each([
    [401, 'AI_UNAUTHORIZED'],
    [429, 'AI_RATE_LIMITED'],
    [503, 'AI_NETWORK_ERROR']
  ] as const)('HTTP %s 转换为 %s', async (status, code) => {
    const client = createAiClient(() => Promise.resolve(chatResponse('{}', status)));

    await expect(client.testConnection(settings)).rejects.toMatchObject({ code });
  });

  it('网络异常转换为可恢复错误且不暴露 API Key', async () => {
    const client = createAiClient(() => Promise.reject(new Error('request secret-key failed')));

    const operation = client.testConnection(settings);

    await expect(operation).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
    try {
      await operation;
      throw new Error('测试需要网络错误');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain('secret-key');
      }
    }
  });

  it('AI 请求超过时限后中止并返回可恢复错误', async () => {
    vi.useFakeTimers();
    try {
      const client = createAiClient(() => new Promise<Response>(() => undefined));
      const operation = client.testConnection(settings);
      const rejection = expect(operation).rejects.toMatchObject({
        code: 'AI_NETWORK_ERROR',
        message: 'AI 请求超时，请稍后重试'
      });

      await vi.advanceTimersByTimeAsync(30_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('AI 已返回响应头但正文不结束时仍会超时', async () => {
    vi.useFakeTimers();
    try {
      const response = new Response(new ReadableStream({ start: () => undefined }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
      const client = createAiClient(() => Promise.resolve(response));
      const operation = client.testConnection(settings);
      const rejection = expect(operation).rejects.toMatchObject({
        code: 'AI_NETWORK_ERROR',
        message: 'AI 请求超时，请稍后重试'
      });

      await vi.advanceTimersByTimeAsync(30_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('拒绝超长 AI 响应', async () => {
    const client = createAiClient(() => Promise.resolve(chatResponse('a'.repeat(20_001))));

    await expect(client.testConnection(settings)).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE'
    });
  });
});
