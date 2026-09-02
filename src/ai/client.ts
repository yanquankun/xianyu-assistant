import type { AppErrorCode } from '../domain/errors';
import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import {
  buildConnectionMessages,
  buildDescriptionPolishMessages,
  buildExpansionMessages,
  type ChatMessage,
  type DescriptionPolishContext
} from './prompts';
import {
  validateExpansion,
  validatePolishedDescription,
  type DescriptionPolishResult,
  type ExpansionPreview
} from './validation';

export class AiClientError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
  }
}

export interface AiConnectionResult {
  connected: true;
  model: string;
}

export interface AiClient {
  testConnection(settings: AiSettings): Promise<AiConnectionResult>;
  expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreview>;
  polishDescription(
    settings: AiSettings,
    draft: ProductDraft,
    options: DescriptionPolishOptions
  ): Promise<DescriptionPolishResult>;
}

export interface DescriptionPolishOptions {
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const AI_REQUEST_TIMEOUT_MS = 30_000;
const MAX_AI_CONTENT_LENGTH = 20_000;
const MAX_AI_RESPONSE_BYTES = 1_000_000;
const MAX_POLISHED_DESCRIPTION_LENGTH = 5_000;
const MAX_DEEPSEEK_POLISH_COMPLETION_TOKENS = 4_096;

const POLISH_PLATFORM_LABELS: Record<ProductDraft['platform'], DescriptionPolishContext['platform']> = {
  taobao: '淘宝',
  tmall: '天猫',
  jd: '京东',
  generic: '其他来源'
};

function validateSettings(settings: AiSettings): void {
  if (settings.apiKey.trim().length === 0 || settings.model.trim().length === 0) {
    throw new AiClientError('AI_CONFIG_INVALID', '请填写 API Key 和模型名称');
  }
  if (
    !Number.isFinite(settings.temperature) ||
    settings.temperature < 0 ||
    settings.temperature > 2
  ) {
    throw new AiClientError('AI_CONFIG_INVALID', 'Temperature 必须在 0 到 2 之间');
  }
}

export function normalizeChatCompletionsUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new AiClientError('AI_CONFIG_INVALID', '请输入有效的 AI Base URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiClientError('AI_CONFIG_INVALID', 'AI Base URL 仅支持 HTTP 或 HTTPS');
  }
  const hostname = url.hostname.toLowerCase();
  const isLocalhost =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';
  if (url.protocol === 'http:' && !isLocalhost) {
    throw new AiClientError('AI_CONFIG_INVALID', '远程 AI Base URL 必须使用 HTTPS');
  }
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  const path = url.pathname.replace(/\/+$/u, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应缺少 choices');
  }
  const choices = payload.choices as unknown[];
  const choice = choices.at(0);
  if (
    !isRecord(choice) ||
    !isRecord(choice.message) ||
    typeof choice.message.content !== 'string'
  ) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应缺少消息内容');
  }
  if (choice.message.content.length > MAX_AI_CONTENT_LENGTH) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应内容过长');
  }
  return choice.message.content;
}

function errorForStatus(status: number): AiClientError {
  if (status === 401 || status === 403) {
    return new AiClientError('AI_UNAUTHORIZED', 'AI 接口认证失败，请检查 API Key');
  }
  if (status === 429) {
    return new AiClientError('AI_RATE_LIMITED', 'AI 接口请求过于频繁，请稍后重试');
  }
  return new AiClientError('AI_NETWORK_ERROR', `AI 接口返回 HTTP ${String(status)}`);
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > MAX_AI_RESPONSE_BYTES) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应数据过大');
  }
  if (response.body === null) {
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return `${text}${decoder.decode()}`;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_AI_RESPONSE_BYTES) {
      await reader.cancel('AI 响应数据过大');
      throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应数据过大');
    }
    text += decoder.decode(value, { stream: true });
  }
}

async function requestChat(
  fetchImpl: FetchLike,
  settings: AiSettings,
  messages: readonly ChatMessage[],
  jsonMode: boolean
): Promise<string> {
  validateSettings(settings);
  const url = normalizeChatCompletionsUrl(settings.baseUrl);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        throw errorForStatus(response.status);
      }
      const responseText = await readBoundedResponseText(response);
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new AiClientError('AI_INVALID_RESPONSE', 'AI 接口没有返回有效 JSON');
      }
      return extractContent(payload);
    })();
    const timeoutRequest = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AiClientError('AI_NETWORK_ERROR', 'AI 请求超时，请稍后重试'));
      }, AI_REQUEST_TIMEOUT_MS);
    });
    return await Promise.race([request, timeoutRequest]);
  } catch (error) {
    if (error instanceof AiClientError) {
      throw error;
    }
    throw new AiClientError('AI_NETWORK_ERROR', '无法连接 AI 接口，请检查地址和网络');
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function readStreamDelta(payload: unknown): string[] {
  if (!isRecord(payload)) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应格式无效');
  }
  if (isRecord(payload.error)) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应返回错误');
  }
  if (!Array.isArray(payload.choices)) {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应缺少 choices');
  }
  const deltas: string[] = [];
  for (const choice of payload.choices as unknown[]) {
    if (!isRecord(choice) || !isRecord(choice.delta)) {
      continue;
    }
    const content = choice.delta.content;
    if (content === undefined || content === null) {
      continue;
    }
    if (typeof content !== 'string') {
      throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应包含无效内容');
    }
    if (content.length > 0) {
      deltas.push(content);
    }
  }
  return deltas;
}

function eventBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/u.exec(buffer);
  return match?.index === undefined ? null : { index: match.index, length: match[0].length };
}

function isRequestAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function isDeepSeekHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com');
}

async function requestChatStream(
  fetchImpl: FetchLike,
  settings: AiSettings,
  messages: readonly ChatMessage[],
  options: DescriptionPolishOptions
): Promise<string> {
  validateSettings(settings);
  if (isRequestAborted(options.signal)) {
    throw new AiClientError('OPERATION_CANCELLED', 'AI 润色已停止');
  }
  const url = normalizeChatCompletionsUrl(settings.baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const abortRequest = () => {
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  options.signal.addEventListener('abort', abortRequest, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: (error: AiClientError) => void = () => undefined;
  const timeoutRequest = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const resetInactivityTimeout = () => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timedOut = true;
      abortRequest();
      rejectTimeout(new AiClientError('AI_NETWORK_ERROR', 'AI 请求超时，请稍后重试'));
    }, AI_REQUEST_TIMEOUT_MS);
  };
  resetInactivityTimeout();
  const hasTimedOut = () => timedOut;
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature,
          stream: true,
          ...(isDeepSeekHost(url)
            ? {
                thinking: { type: 'disabled' },
                max_tokens: MAX_DEEPSEEK_POLISH_COMPLETION_TOKENS
              }
            : {}),
          messages
        }),
        signal: controller.signal
      }),
      timeoutRequest
    ]);
    resetInactivityTimeout();
    if (!response.ok) {
      throw errorForStatus(response.status);
    }
    if (response.body === null) {
      throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应没有正文');
    }
    reader = response.body.getReader();
    if (isRequestAborted(options.signal)) {
      await reader.cancel().catch(() => undefined);
      throw new AiClientError('OPERATION_CANCELLED', 'AI 润色已停止');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let rawResponse = '';
    let content = '';
    let totalBytes = 0;

    const processEvents = (flush: boolean): boolean => {
      if (flush && buffer.length > 0) {
        buffer += '\n\n';
      }
      for (;;) {
        const boundary = eventBoundary(buffer);
        if (boundary === null) {
          return false;
        }
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const data = event
          .split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /u, ''))
          .join('\n');
        if (data.length === 0) {
          continue;
        }
        if (data === '[DONE]') {
          return true;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          throw new AiClientError('AI_INVALID_RESPONSE', 'AI 流式响应包含无效 JSON');
        }
        for (const delta of readStreamDelta(payload)) {
          content += delta;
          if (content.length > MAX_POLISHED_DESCRIPTION_LENGTH) {
            throw new AiClientError('AI_INVALID_RESPONSE', 'AI 描述超过 5000 个字符');
          }
          options.onDelta(delta);
        }
      }
    };

    for (;;) {
      const chunk = await reader.read();
      if (isRequestAborted(options.signal)) {
        throw new AiClientError('OPERATION_CANCELLED', 'AI 润色已停止');
      }
      if (hasTimedOut()) {
        throw new AiClientError('AI_NETWORK_ERROR', 'AI 请求超时，请稍后重试');
      }
      if (chunk.done) {
        const decoded = decoder.decode();
        buffer += decoded;
        rawResponse += decoded;
        processEvents(true);
        break;
      }
      resetInactivityTimeout();
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_AI_RESPONSE_BYTES) {
        throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应数据过大');
      }
      const decoded = decoder.decode(chunk.value, { stream: true });
      buffer += decoded;
      rawResponse += decoded;
      if (processEvents(false)) {
        break;
      }
    }
    if (content.trim().length === 0 && rawResponse.trimStart().startsWith('{')) {
      let payload: unknown;
      try {
        payload = JSON.parse(rawResponse);
      } catch {
        throw new AiClientError('AI_INVALID_RESPONSE', 'AI 接口没有返回有效的流式数据');
      }
      const fallbackContent = extractContent(payload);
      content = fallbackContent;
      options.onDelta(fallbackContent);
    }
    return content;
  } catch (error) {
    if (isRequestAborted(options.signal)) {
      throw new AiClientError('OPERATION_CANCELLED', 'AI 润色已停止');
    }
    if (hasTimedOut()) {
      throw new AiClientError('AI_NETWORK_ERROR', 'AI 请求超时，请稍后重试');
    }
    if (error instanceof AiClientError) {
      throw error;
    }
    throw new AiClientError('AI_NETWORK_ERROR', '无法连接 AI 接口，请检查地址和网络');
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    options.signal.removeEventListener('abort', abortRequest);
    if (reader !== null) {
      await reader.cancel().catch(() => undefined);
      try {
        reader.releaseLock();
      } catch {
        // The stream may already have released its lock after cancellation.
      }
    }
  }
}

export function createAiClient(fetchImpl: FetchLike): AiClient {
  return {
    async testConnection(settings: AiSettings): Promise<AiConnectionResult> {
      await requestChat(fetchImpl, settings, buildConnectionMessages(), false);
      return { connected: true, model: settings.model };
    },

    async expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreview> {
      const content = await requestChat(
        fetchImpl,
        settings,
        buildExpansionMessages(settings, draft),
        true
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new AiClientError('AI_INVALID_RESPONSE', 'AI 文案不是有效 JSON');
      }
      try {
        return validateExpansion(parsed, draft);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 文案结构无效';
        throw new AiClientError('AI_INVALID_RESPONSE', message);
      }
    },

    async polishDescription(
      settings: AiSettings,
      draft: ProductDraft,
      options: DescriptionPolishOptions
    ): Promise<DescriptionPolishResult> {
      const polishContext: DescriptionPolishContext = {
        platform: POLISH_PLATFORM_LABELS[draft.platform],
        title: draft.title,
        price: draft.price,
        ...(draft.originalPrice === undefined ? {} : { originalPrice: draft.originalPrice }),
        currency: draft.currency,
        description: draft.description,
        shippingMethod: draft.shippingMethod,
        ...(draft.shippingFee === undefined ? {} : { shippingFee: draft.shippingFee }),
        supportsPickup: draft.supportsPickup,
        categoryNote: draft.categoryNote
      };
      const description = await requestChatStream(
        fetchImpl,
        settings,
        buildDescriptionPolishMessages(settings.systemInstruction, polishContext),
        options
      );
      try {
        return validatePolishedDescription(description, draft);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 描述结构无效';
        throw new AiClientError('AI_INVALID_RESPONSE', message);
      }
    }
  };
}
