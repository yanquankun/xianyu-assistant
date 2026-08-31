import type { AiSettings } from './settings';
import type { ParsedProduct, ProductDraft } from './product';

export type RuntimeMessage =
  | { type: 'PARSE_PRODUCT'; operationId: string; url: string }
  | { type: 'TEST_AI_CONNECTION'; settings: AiSettings }
  | { type: 'EXPAND_DRAFT'; settings: AiSettings; draft: ProductDraft }
  | { type: 'CHECK_XIANYU_LOGIN' }
  | { type: 'FILL_XIANYU_DRAFT'; draft: ProductDraft }
  | { type: 'OPEN_XIANYU_LOGIN' };

export const runtimeMessageTypes: readonly RuntimeMessage['type'][] = [
  'PARSE_PRODUCT',
  'TEST_AI_CONNECTION',
  'EXPAND_DRAFT',
  'CHECK_XIANYU_LOGIN',
  'FILL_XIANYU_DRAFT',
  'OPEN_XIANYU_LOGIN'
];

const MAX_IMAGES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximum: number, allowEmpty = true): value is string {
  return (
    typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullablePrice(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value >= 0);
}

function isOptionalPrice(value: unknown): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value > 0);
}

function isStringArray(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) && value.length <= maximum && value.every((entry) => isText(entry, 1_000))
  );
}

export function isAiSettings(value: unknown): value is AiSettings {
  return (
    isRecord(value) &&
    isText(value.baseUrl, 2_048) &&
    isText(value.apiKey, 8_192) &&
    isText(value.model, 200) &&
    isFiniteNumber(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 2 &&
    isText(value.systemInstruction, 4_000)
  );
}

function isProductImage(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.id, 200, false) &&
    isText(value.url, 4_096, false) &&
    typeof value.source === 'string' &&
    ['json-ld', 'open-graph', 'meta', 'dom', 'user'].includes(value.source) &&
    typeof value.selected === 'boolean' &&
    typeof value.loadStatus === 'string' &&
    ['idle', 'loaded', 'failed'].includes(value.loadStatus)
  );
}

function isSourceFacts(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.title, 500) &&
    isText(value.description, 20_000) &&
    isNullablePrice(value.price) &&
    isOptionalPrice(value.originalPrice) &&
    isText(value.currency, 20, false)
  );
}

export function isProductDraft(value: unknown): value is ProductDraft {
  return (
    isRecord(value) &&
    isText(value.id, 200, false) &&
    typeof value.platform === 'string' &&
    ['taobao', 'jd', 'generic'].includes(value.platform) &&
    isText(value.canonicalUrl, 4_096) &&
    isSourceFacts(value.source) &&
    isText(value.title, 500) &&
    isText(value.description, 20_000) &&
    isNullablePrice(value.price) &&
    isOptionalPrice(value.originalPrice) &&
    isText(value.currency, 20, false) &&
    Array.isArray(value.images) &&
    value.images.length <= MAX_IMAGES &&
    value.images.every(isProductImage) &&
    isStringArray(value.warnings, 100) &&
    typeof value.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(value.confidence) &&
    isText(value.shippingMethod, 100) &&
    isText(value.categoryNote, 1_000) &&
    isText(value.updatedAt, 100, false)
  );
}

export function parseParsedProduct(value: unknown): ParsedProduct | null {
  return isRecord(value) &&
    typeof value.platform === 'string' &&
    ['taobao', 'jd', 'generic'].includes(value.platform) &&
    isText(value.canonicalUrl, 4_096) &&
    isText(value.title, 500) &&
    isText(value.description, 20_000) &&
    isNullablePrice(value.price) &&
    isOptionalPrice(value.originalPrice) &&
    isText(value.currency, 20, false) &&
    Array.isArray(value.images) &&
    value.images.length <= MAX_IMAGES &&
    value.images.every(isProductImage) &&
    isStringArray(value.warnings, 100) &&
    typeof value.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(value.confidence)
    ? (value as unknown as ParsedProduct)
    : null;
}

export function parseRuntimeMessage(value: unknown): RuntimeMessage | null {
  if (!isRecord(value) || !isText(value.type, 100, false)) {
    return null;
  }
  switch (value.type) {
    case 'PARSE_PRODUCT':
      return isText(value.operationId, 200, false) && isText(value.url, 4_096, false)
        ? { type: value.type, operationId: value.operationId, url: value.url }
        : null;
    case 'TEST_AI_CONNECTION':
      return isAiSettings(value.settings) ? { type: value.type, settings: value.settings } : null;
    case 'EXPAND_DRAFT':
      return isAiSettings(value.settings) && isProductDraft(value.draft)
        ? { type: value.type, settings: value.settings, draft: value.draft }
        : null;
    case 'FILL_XIANYU_DRAFT':
      return isProductDraft(value.draft) ? { type: value.type, draft: value.draft } : null;
    case 'CHECK_XIANYU_LOGIN':
    case 'OPEN_XIANYU_LOGIN':
      return { type: value.type };
    default:
      return null;
  }
}
