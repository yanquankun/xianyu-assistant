import type { AiSettings } from './settings';
import type {
  ParsedProduct,
  ProductExtractionResponse,
  ProductDraft,
  ProductImage,
  ProductImageLocation,
  ProductVideo,
  RemoteImageExtractionSource,
  StoredDraftParseResult
} from './product';
import { MAX_MEDIA_COUNT } from '../media/validation';
import { classifyProductHost } from './product-url';

const PRODUCT_PLATFORMS = ['taobao', 'tmall', 'jd', 'generic'] as const;

function isProductPlatform(value: unknown): value is ProductDraft['platform'] {
  return PRODUCT_PLATFORMS.some((platform) => platform === value);
}

export type RuntimeMessage =
  | {
      type: 'PARSE_PRODUCT';
      operationId: string;
      submittedUrl: string;
      url: string;
      hintedTitle?: string;
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
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

function isHttpUrl(value: unknown): value is string {
  if (!isText(value, 4_096, false) || value !== value.trim()) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function isProductImageLocation(value: unknown): value is ProductImageLocation {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'remote') {
    return isHttpUrl(value.url) && isRemoteImageExtractionSource(value.extractedBy);
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
    hasOnlyKeys(value, ['id', 'location', 'loadStatus']) &&
    isText(value.id, 200, false) &&
    isProductImageLocation(value.location) &&
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
    isProductPlatform(value.platform) &&
    (value.submittedUrl === undefined || isHttpUrl(value.submittedUrl)) &&
    isText(value.canonicalUrl, 4_096) &&
    isSourceFacts(value.source) &&
    isText(value.title, 500) &&
    isText(value.description, 20_000) &&
    isNullablePrice(value.price) &&
    isOptionalPrice(value.originalPrice) &&
    isText(value.currency, 20, false) &&
    Array.isArray(value.images) &&
    value.images.length <= MAX_MEDIA_COUNT &&
    value.images.every(isProductImage) &&
    Array.isArray(value.videos) &&
    value.videos.length <= MAX_MEDIA_COUNT &&
    value.videos.every(isProductVideo) &&
    value.images.length + value.videos.length <= MAX_MEDIA_COUNT &&
    isStringArray(value.warnings, 100) &&
    typeof value.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(value.confidence) &&
    isText(value.shippingMethod, 100) &&
    isText(value.categoryNote, 1_000) &&
    isText(value.updatedAt, 100, false)
  );
}

function migrateStoredImage(value: unknown): ProductImage | null {
  if (
    !isRecord(value) ||
    !isText(value.id, 200, false) ||
    typeof value.selected !== 'boolean' ||
    !value.selected ||
    typeof value.loadStatus !== 'string' ||
    !['idle', 'loaded', 'failed'].includes(value.loadStatus)
  ) {
    return null;
  }
  if (isProductImageLocation(value.location)) {
    return {
      id: value.id,
      location: value.location,
      loadStatus: value.loadStatus as ProductImage['loadStatus']
    };
  }
  if (!isHttpUrl(value.url) || !isRemoteImageExtractionSource(value.source)) {
    return null;
  }
  return {
    id: value.id,
    location: { kind: 'remote', url: value.url, extractedBy: value.source },
    loadStatus: value.loadStatus as ProductImage['loadStatus']
  };
}

function migrateStoredPlatform(draft: ProductDraft): StoredDraftParseResult {
  if (draft.platform !== 'taobao') {
    return { draft, migrated: false };
  }
  try {
    if (classifyProductHost(new URL(draft.canonicalUrl).hostname).platformHint === 'tmall') {
      return { draft: { ...draft, platform: 'tmall' }, migrated: true };
    }
  } catch {
    // Empty and legacy malformed canonical URLs remain unchanged.
  }
  return { draft, migrated: false };
}

export function parseStoredProductDraft(value: unknown): StoredDraftParseResult | null {
  if (isProductDraft(value)) {
    return migrateStoredPlatform(value);
  }
  if (!isRecord(value) || !Array.isArray(value.images)) {
    return null;
  }
  const oldVideo = isProductVideo(value.video) ? value.video : null;
  const storedVideos = Array.isArray(value.videos)
    ? value.videos.filter(isProductVideo).slice(0, MAX_MEDIA_COUNT)
    : oldVideo === null
      ? []
      : [oldVideo];
  const images: ProductImage[] = [];
  let removedImage = false;
  let migrated = value.videos === undefined || value.video !== undefined;
  const availableImageSlots = MAX_MEDIA_COUNT - storedVideos.length;
  for (const image of value.images) {
    if (images.length >= availableImageSlots) {
      removedImage = true;
      continue;
    }
    if (isProductImage(image)) {
      images.push(image);
      continue;
    }
    const legacyImage = migrateStoredImage(image);
    if (legacyImage === null) {
      removedImage = true;
      continue;
    }
    images.push(legacyImage);
    migrated = true;
  }
  const warnings = isStringArray(value.warnings, 100) ? [...value.warnings] : null;
  if (warnings === null) {
    return null;
  }
  if (removedImage && !warnings.includes('已移除无法恢复的旧版图片')) {
    if (warnings.length === 100) {
      warnings.shift();
    }
    warnings.push('已移除无法恢复的旧版图片');
  }
  const candidate: Record<string, unknown> = { ...value, images, videos: storedVideos, warnings };
  delete candidate.video;
  if (!isProductDraft(candidate)) {
    return null;
  }
  const platformResult = migrateStoredPlatform(candidate);
  return {
    draft: platformResult.draft,
    migrated: migrated || removedImage || platformResult.migrated
  };
}

export function parseParsedProduct(value: unknown): ParsedProduct | null {
  return isRecord(value) &&
    isProductPlatform(value.platform) &&
    (value.submittedUrl === undefined || isHttpUrl(value.submittedUrl)) &&
    isText(value.canonicalUrl, 4_096) &&
    isText(value.title, 500) &&
    isText(value.description, 20_000) &&
    isNullablePrice(value.price) &&
    isOptionalPrice(value.originalPrice) &&
    isText(value.currency, 20, false) &&
    Array.isArray(value.images) &&
    value.images.length <= MAX_MEDIA_COUNT &&
    value.images.every(isProductImage) &&
    isStringArray(value.warnings, 100) &&
    typeof value.confidence === 'string' &&
    ['high', 'medium', 'low'].includes(value.confidence)
    ? (value as unknown as ParsedProduct)
    : null;
}

export function parseProductExtractionResponse(value: unknown): ProductExtractionResponse | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return null;
  }
  if (value.ok) {
    const product = parseParsedProduct(value.product);
    return product === null ? null : { ok: true, product };
  }
  if (!isRecord(value.error) || !isText(value.error.message, 1_000, false)) {
    return null;
  }
  const keys = Object.keys(value.error);
  if (keys.some((key) => key !== 'message' && key !== 'code')) {
    return null;
  }
  if (value.error.code !== undefined && !isText(value.error.code, 100, false)) {
    return null;
  }
  return {
    ok: false,
    error: {
      message: value.error.message,
      ...(value.error.code === undefined ? {} : { code: value.error.code })
    }
  };
}

export function parseRuntimeMessage(value: unknown): RuntimeMessage | null {
  if (!isRecord(value) || !isText(value.type, 100, false)) {
    return null;
  }
  switch (value.type) {
    case 'PARSE_PRODUCT':
      return hasOnlyKeys(value, ['type', 'operationId', 'submittedUrl', 'url', 'hintedTitle']) &&
        isText(value.operationId, 200, false) &&
        isHttpUrl(value.submittedUrl) &&
        isHttpUrl(value.url) &&
        (value.hintedTitle === undefined || isText(value.hintedTitle, 500, false))
        ? {
            type: value.type,
            operationId: value.operationId,
            submittedUrl: value.submittedUrl,
            url: value.url,
            ...(value.hintedTitle === undefined ? {} : { hintedTitle: value.hintedTitle })
          }
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
