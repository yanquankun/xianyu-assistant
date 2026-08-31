import type { AiSettings } from './settings';
import type {
  ParsedProduct,
  ProductDraft,
  ProductImage,
  ProductImageLocation,
  ProductVideo,
  RemoteImageExtractionSource,
  StoredDraftParseResult
} from './product';

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

function isRemoteImageExtractionSource(value: unknown): value is RemoteImageExtractionSource {
  return typeof value === 'string' && ['json-ld', 'open-graph', 'meta', 'dom'].includes(value);
}

function isProductImageLocation(value: unknown): value is ProductImageLocation {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'remote') {
    return isText(value.url, 4_096, false) && isRemoteImageExtractionSource(value.extractedBy);
  }
  return (
    value.kind === 'local' &&
    isText(value.assetId, 200, false) &&
    isText(value.fileName, 300, false) &&
    typeof value.mimeType === 'string' &&
    ['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType) &&
    isFiniteNumber(value.byteLength) &&
    value.byteLength > 0
  );
}

function isProductImage(value: unknown): value is ProductImage {
  return (
    isRecord(value) &&
    isText(value.id, 200, false) &&
    isProductImageLocation(value.location) &&
    typeof value.selected === 'boolean' &&
    typeof value.loadStatus === 'string' &&
    ['idle', 'loaded', 'failed'].includes(value.loadStatus)
  );
}

function isProductVideo(value: unknown): value is ProductVideo {
  return (
    isRecord(value) &&
    isText(value.id, 200, false) &&
    isText(value.assetId, 200, false) &&
    isText(value.fileName, 300, false) &&
    typeof value.mimeType === 'string' &&
    ['video/mp4', 'video/quicktime'].includes(value.mimeType) &&
    isFiniteNumber(value.byteLength) &&
    value.byteLength > 0
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
    (value.video === undefined || isProductVideo(value.video)) &&
    isStringArray(value.warnings, 100) &&
    typeof value.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(value.confidence) &&
    isText(value.shippingMethod, 100) &&
    isText(value.categoryNote, 1_000) &&
    isText(value.updatedAt, 100, false)
  );
}

function migrateLegacyImage(value: unknown): ProductImage | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 200, false) ||
    !isText(value.url, 4_096, false) ||
    !isRemoteImageExtractionSource(value.source) ||
    typeof value.selected !== 'boolean' ||
    typeof value.loadStatus !== 'string' ||
    !['idle', 'loaded', 'failed'].includes(value.loadStatus)
  ) {
    return null;
  }
  return {
    id: value.id,
    location: { kind: 'remote', url: value.url, extractedBy: value.source },
    selected: value.selected,
    loadStatus: value.loadStatus as ProductImage['loadStatus']
  };
}

export function parseStoredProductDraft(value: unknown): StoredDraftParseResult | null {
  if (isProductDraft(value)) {
    return { draft: value, migrated: false };
  }
  if (!isRecord(value) || !Array.isArray(value.images)) {
    return null;
  }
  const images: ProductImage[] = [];
  let removedImage = false;
  let migrated = false;
  for (const image of value.images.slice(0, MAX_IMAGES)) {
    if (isProductImage(image)) {
      images.push(image);
      continue;
    }
    const legacyImage = migrateLegacyImage(image);
    if (legacyImage === null) {
      removedImage = true;
      continue;
    }
    images.push(legacyImage);
    migrated = true;
  }
  if (value.images.length > MAX_IMAGES) {
    removedImage = true;
  }
  const warnings = isStringArray(value.warnings, 100) ? [...value.warnings] : null;
  if (warnings === null) {
    return null;
  }
  if (removedImage && !warnings.includes('已移除无法恢复的旧版图片')) {
    if (warnings.length === 100) {
      return null;
    }
    warnings.push('已移除无法恢复的旧版图片');
  }
  const candidate = { ...value, images, warnings };
  if (!isProductDraft(candidate)) {
    return null;
  }
  return { draft: candidate, migrated: migrated || removedImage };
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
