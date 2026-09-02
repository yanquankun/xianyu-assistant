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
  originalPrice: 129,
  currency: 'CNY',
  images: [
    {
      id: 'private-image',
      location: {
        kind: 'remote',
        url: 'https://media.example.com/private-image.jpg',
        extractedBy: 'platform-gallery'
      },
      loadStatus: 'loaded'
    }
  ],
  videos: [],
  warnings: ['不应发送的内部警告'],
  confidence: 'high',
  shippingMethod: '一口价',
  shippingFee: 12,
  supportsPickup: true,
  categoryNote: '家用电器',
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

function streamResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

function byteStreamResponse(bytes: Uint8Array, splitAt: number): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      }
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
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
  it('按 SSE 分片输出润色后的商品描述并启用 stream 参数', async () => {
    const deltas: string[] = [];
    let requestBody = '';
    const client = createAiClient((_input, init) => {
      requestBody = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"自然"}}]}\n',
          '\ndata: {"choices":[{"delta":{"content":"清晰的描述"}}]}\n\n',
          'data: {"choices":[],"usage":{"total_tokens":12}}\n\n',
          'data: [DONE]\n\n'
        ])
      );
    });

    const result = await client.polishDescription(settings, draft, {
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta)
    });

    expect(result.description).toBe('自然清晰的描述');
    expect(deltas).toEqual(['自然', '清晰的描述']);
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('response_format');
    const messages = body.messages as { role: string; content: string }[];
    const userContent = messages.find((message) => message.role === 'user')?.content ?? '';
    const serializedMessages = JSON.stringify(messages);
    expect(userContent).toContain('当前标题');
    expect(userContent).toContain('原始描述');
    expect(userContent).toContain('商品标题：当前标题');
    expect(userContent).toContain('售价：99 CNY');
    expect(userContent).toContain('原价：129 CNY');
    expect(userContent).toContain('商品描述：原始描述');
    expect(userContent).toContain('发货方式：一口价');
    expect(userContent).toContain('邮费金额：12 CNY');
    expect(userContent).toContain('支持自提：是');
    expect(userContent).toContain('分类备注：家用电器');
    expect(serializedMessages).not.toContain(draft.canonicalUrl);
    expect(serializedMessages).not.toContain('不应发送的内部警告');
    expect(serializedMessages).not.toContain('private-image.jpg');
  });

  it('兼容忽略 stream 参数而返回普通 Chat Completions JSON 的接口', async () => {
    const deltas: string[] = [];
    const client = createAiClient(() => Promise.resolve(chatResponse('普通响应中的商品描述')));

    const result = await client.polishDescription(settings, draft, {
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta)
    });

    expect(result.description).toBe('普通响应中的商品描述');
    expect(deltas).toEqual(['普通响应中的商品描述']);
  });

  it('DeepSeek 商品润色关闭思考模式并限制生成规模', async () => {
    let requestBody = '';
    const client = createAiClient((_input, init) => {
      requestBody = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"简洁商品描述"}}]}\n\n',
          'data: [DONE]\n\n'
        ])
      );
    });

    await client.polishDescription(
      {
        ...settings,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro'
      },
      draft,
      {
        signal: new AbortController().signal,
        onDelta: () => undefined
      }
    );

    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(4_096);
  });

  it('SSE 数据和中文字符跨网络分片时仍能完整解析', async () => {
    const source =
      'data: {"choices":[{"delta":{"content":"闲置好物"}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(source);
    const chineseByte = new TextEncoder().encode('闲').at(0);
    const splitAt = bytes.findIndex((value) => value === chineseByte) + 1;
    const client = createAiClient(() => Promise.resolve(byteStreamResponse(bytes, splitAt)));

    const result = await client.polishDescription(settings, draft, {
      signal: new AbortController().signal,
      onDelta: () => undefined
    });

    expect(result.description).toBe('闲置好物');
  });

  it('主动取消润色时中止流读取并报告已取消', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ start: () => undefined }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    });
    const client = createAiClient(() => Promise.resolve(response));
    const operation = client.polishDescription(settings, draft, {
      signal: controller.signal,
      onDelta: () => undefined
    });

    controller.abort();

    await expect(operation).rejects.toMatchObject({
      code: 'OPERATION_CANCELLED',
      message: 'AI 润色已停止'
    });
  });

  it('流式错误不向界面暴露配置中的 API Key', async () => {
    const client = createAiClient(() =>
      Promise.resolve(
        streamResponse([
          'data: {"error":{"message":"Incorrect API key provided: secret-key"}}\n\n'
        ])
      )
    );

    const operation = client.polishDescription(settings, draft, {
      signal: new AbortController().signal,
      onDelta: () => undefined
    });

    await expect(operation).rejects.toMatchObject({
      code: 'AI_INVALID_RESPONSE',
      message: 'AI 流式响应返回错误'
    });
    await expect(operation).rejects.not.toThrow('secret-key');
  });

  it.each([
    ['结束标记', 'data: [DONE]\n\n'],
    ['无效事件', 'data: not-json\n\n']
  ])('%s 后关闭仍保持连接的响应流', async (_label, event) => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(event));
        },
        cancel() {
          cancelled = true;
        }
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
    const client = createAiClient(() => Promise.resolve(response));
    const operation = client.polishDescription(settings, draft, {
      signal: new AbortController().signal,
      onDelta: () => undefined
    });

    await expect(operation).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(cancelled).toBe(true);
  });

  it('流式请求在响应头返回前超过时限也会结束', async () => {
    vi.useFakeTimers();
    try {
      const client = createAiClient(() => new Promise<Response>(() => undefined));
      const operation = client.polishDescription(settings, draft, {
        signal: new AbortController().signal,
        onDelta: () => undefined
      });
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

  it('持续收到分片时不会按整段请求时长提前中止', async () => {
    vi.useFakeTimers();
    try {
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const encoder = new TextEncoder();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"持续"}}]}\n\n')
            );
          }
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
      const client = createAiClient(() => Promise.resolve(response));
      const operation = client.polishDescription(settings, draft, {
        signal: new AbortController().signal,
        onDelta: () => undefined
      });

      await vi.advanceTimersByTimeAsync(25_000);
      streamController.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"输出"}}]}\n\n')
      );
      await vi.advanceTimersByTimeAsync(25_000);
      streamController.enqueue(encoder.encode('data: [DONE]\n\n'));

      await expect(operation).resolves.toMatchObject({ description: '持续输出' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('流式接口没有输出描述时拒绝写入空内容', async () => {
    const client = createAiClient(() =>
      Promise.resolve(streamResponse(['data: {"choices":[]}\n\ndata: [DONE]\n\n']))
    );

    await expect(
      client.polishDescription(settings, draft, {
        signal: new AbortController().signal,
        onDelta: () => undefined
      })
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });

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
