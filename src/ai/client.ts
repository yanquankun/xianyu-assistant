import type { AppErrorCode } from '../domain/errors';
import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import { buildConnectionMessages, buildExpansionMessages, type ChatMessage } from './prompts';
import { validateExpansion, type ExpansionPreview } from './validation';

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
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function validateSettings(settings: AiSettings): void {
  if (settings.apiKey.trim().length === 0 || settings.model.trim().length === 0) {
    throw new AiClientError('AI_CONFIG_INVALID', '请填写 API Key 和模型名称');
  }
  if (!Number.isFinite(settings.temperature) || settings.temperature < 0 || settings.temperature > 2) {
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
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 响应缺少消息内容');
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

async function requestChat(
  fetchImpl: FetchLike,
  settings: AiSettings,
  messages: readonly ChatMessage[]
): Promise<string> {
  validateSettings(settings);
  const url = normalizeChatCompletionsUrl(settings.baseUrl);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        response_format: { type: 'json_object' },
        messages
      })
    });
  } catch {
    throw new AiClientError('AI_NETWORK_ERROR', '无法连接 AI 接口，请检查地址和网络');
  }
  if (!response.ok) {
    throw errorForStatus(response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiClientError('AI_INVALID_RESPONSE', 'AI 接口没有返回有效 JSON');
  }
  return extractContent(payload);
}

export function createAiClient(fetchImpl: FetchLike): AiClient {
  return {
    async testConnection(settings: AiSettings): Promise<AiConnectionResult> {
      await requestChat(fetchImpl, settings, buildConnectionMessages());
      return { connected: true, model: settings.model };
    },

    async expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreview> {
      const content = await requestChat(fetchImpl, settings, buildExpansionMessages(settings, draft));
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
    }
  };
}
