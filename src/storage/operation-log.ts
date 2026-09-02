import { sanitizeProductLogUrl } from '../domain/product-url';
import type { ProductPlatform } from '../domain/product';

export type OperationStage = 'parse' | 'permission' | 'ai' | 'login' | 'fill' | 'system';

export type OperationOutcome = 'success' | 'failure' | 'warning';

export interface OperationDraftSnapshot {
  sourceUrl?: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  shippingMethod?: string;
  shippingFee?: number;
  supportsPickup?: boolean;
  categoryNote?: string;
  selectedImageCount?: number;
  videoName?: string;
}

export interface OperationSourceSummary {
  platform: ProductPlatform;
  canonicalUrl: string;
  imageUrls?: string[];
  fields: {
    title: boolean;
    description: boolean;
    price: boolean;
    originalPrice: boolean;
    imageCount: number;
  };
}

export interface OperationLogDetails {
  draft?: OperationDraftSnapshot;
  source?: OperationSourceSummary;
  warnings?: string[];
  result?: string;
  error?: string;
}

export interface OperationLogEntry {
  id: string;
  timestamp: string;
  stage: OperationStage;
  outcome: OperationOutcome;
  message: string;
  displayTitle?: string;
  operationLabel?: string;
  code?: string;
  details?: OperationLogDetails;
}

const MAX_LOG_ENTRIES = 100;
const MAX_LOG_TEXT_LENGTH = 4_000;
const MAX_LOG_TITLE_LENGTH = 500;
const MAX_LOG_CODE_LENGTH = 100;
const MAX_LOG_WARNINGS = 100;
const MAX_LOG_SELECTED_IMAGES = 9;
const UNSAFE_CONTENT_PLACEHOLDER = '[已省略不安全内容]';
const INVALID_LOG_ID_PLACEHOLDER = 'invalid-log-id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum: number, allowEmpty = true): value is string {
  return (
    typeof value === 'string' && value.length <= maximum && (allowEmpty || value.trim().length > 0)
  );
}

function isOperationStage(value: unknown): value is OperationStage {
  return (
    value === 'parse' ||
    value === 'permission' ||
    value === 'ai' ||
    value === 'login' ||
    value === 'fill' ||
    value === 'system'
  );
}

function isOperationOutcome(value: unknown): value is OperationOutcome {
  return value === 'success' || value === 'failure' || value === 'warning';
}

function redactUrlCredentials(value: string): string {
  return value.replace(/\bhttps?:\/\/[^\s]+/giu, (candidate) => {
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

function containsUnsafeContent(value: string): boolean {
  const normalized = value.trim();
  return (
    /\b(?:blob:|data:|file:)/iu.test(normalized) ||
    /^(?:\/[A-Za-z0-9._-]+)+/u.test(normalized) ||
    /(?:^|[\s(])\/(?:Users|home|tmp|var|private)\//iu.test(normalized) ||
    /^[A-Za-z]:[\\/]/u.test(normalized) ||
    /<!doctype|<html\b|<body\b|<script\b/iu.test(normalized)
  );
}

function sanitizeText(value: string, maximum = MAX_LOG_TEXT_LENGTH): string {
  if (containsUnsafeContent(value)) {
    return UNSAFE_CONTENT_PLACEHOLDER;
  }
  const redacted = redactUrlCredentials(value)
    .replace(/\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/giu, 'Authorization: [已脱敏]')
    .replace(/\bbearer\s+[^\s,;]+/giu, '[已脱敏]')
    .replace(/\bauth(?:entication)?(?:[_ -]?(?:token|key))?\s*[:=]\s*[^\s,;]+/giu, 'auth=[已脱敏]')
    .replace(/\b(?:api[_ -]?key|x-api-key)\s*[:=]\s*[^\s,;]+/giu, 'apiKey=[已脱敏]')
    .replace(/\basset[_ -]?id\s*[:=]\s*[^\s,;]+/giu, 'assetId=[已脱敏]')
    .replace(/\b(?:local|asset)-[a-z0-9][a-z0-9-]{5,}\b/giu, '[资源标识已脱敏]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
      '[资源标识已脱敏]'
    )
    .replace(/\b(?:set-)?cookie\s*:\s*.*?(?=\s+https?:\/\/|$)/giu, 'Cookie: [已脱敏]')
    .replace(
      /([?&](?:authorization|token|access_token|api[_-]?key|key)=)[^&#\s]+/giu,
      '$1[已脱敏]'
    );
  return redacted.slice(0, maximum);
}

function sanitizeLogId(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value) ? value : INVALID_LOG_ID_PLACEHOLDER;
}

function sanitizeImageUrl(value: string): string | undefined {
  if (!isBoundedText(value, 4_096, false)) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|auth|key|sign|credential|expires|x-amz/iu.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function sanitizeImageUrls(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  const sanitized = [
    ...new Set(values.flatMap((value) => sanitizeImageUrl(value) ?? []).slice(0, 9))
  ];
  return sanitized.length === 0 ? undefined : sanitized;
}

function sanitizeDraftSnapshot(draft: OperationDraftSnapshot): OperationDraftSnapshot | undefined {
  const sourceUrl =
    draft.sourceUrl === undefined ? undefined : sanitizeProductLogUrl(draft.sourceUrl);
  const canonicalUrl =
    draft.canonicalUrl === undefined ? undefined : sanitizeProductLogUrl(draft.canonicalUrl);
  const title =
    draft.title === undefined ? undefined : sanitizeText(draft.title, MAX_LOG_TITLE_LENGTH);
  const description =
    draft.description === undefined
      ? undefined
      : sanitizeText(draft.description, MAX_LOG_TEXT_LENGTH);
  const shippingMethod =
    draft.shippingMethod === undefined
      ? undefined
      : sanitizeText(draft.shippingMethod, MAX_LOG_TITLE_LENGTH);
  const categoryNote =
    draft.categoryNote === undefined
      ? undefined
      : sanitizeText(draft.categoryNote, MAX_LOG_TEXT_LENGTH);
  const videoName =
    draft.videoName === undefined ? undefined : sanitizeText(draft.videoName, MAX_LOG_TITLE_LENGTH);
  const price = Number.isFinite(draft.price) && (draft.price ?? 0) >= 0 ? draft.price : undefined;
  const originalPrice =
    Number.isFinite(draft.originalPrice) && (draft.originalPrice ?? 0) > 0
      ? draft.originalPrice
      : undefined;
  const shippingFee =
    Number.isFinite(draft.shippingFee) && (draft.shippingFee ?? 0) > 0
      ? draft.shippingFee
      : undefined;
  const supportsPickup =
    typeof draft.supportsPickup === 'boolean' ? draft.supportsPickup : undefined;
  const selectedImageCount =
    Number.isInteger(draft.selectedImageCount) &&
    (draft.selectedImageCount ?? -1) >= 0 &&
    (draft.selectedImageCount ?? MAX_LOG_SELECTED_IMAGES + 1) <= MAX_LOG_SELECTED_IMAGES
      ? draft.selectedImageCount
      : undefined;
  const sanitized = {
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(price === undefined ? {} : { price }),
    ...(originalPrice === undefined ? {} : { originalPrice }),
    ...(shippingMethod === undefined ? {} : { shippingMethod }),
    ...(shippingFee === undefined ? {} : { shippingFee }),
    ...(supportsPickup === undefined ? {} : { supportsPickup }),
    ...(categoryNote === undefined ? {} : { categoryNote }),
    ...(selectedImageCount === undefined ? {} : { selectedImageCount }),
    ...(videoName === undefined ? {} : { videoName })
  };
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function isProductPlatform(value: unknown): value is ProductPlatform {
  return value === 'taobao' || value === 'tmall' || value === 'jd' || value === 'generic';
}

function sanitizeSourceSummary(source: OperationSourceSummary): OperationSourceSummary | undefined {
  const canonicalUrl = sanitizeProductLogUrl(source.canonicalUrl);
  const imageUrls = sanitizeImageUrls(source.imageUrls);
  if (
    !isProductPlatform(source.platform) ||
    canonicalUrl === undefined ||
    typeof source.fields.title !== 'boolean' ||
    typeof source.fields.description !== 'boolean' ||
    typeof source.fields.price !== 'boolean' ||
    typeof source.fields.originalPrice !== 'boolean' ||
    !Number.isInteger(source.fields.imageCount)
  ) {
    return undefined;
  }
  return {
    platform: source.platform,
    canonicalUrl,
    ...(imageUrls === undefined ? {} : { imageUrls }),
    fields: {
      title: source.fields.title,
      description: source.fields.description,
      price: source.fields.price,
      originalPrice: source.fields.originalPrice,
      imageCount: Math.min(MAX_LOG_SELECTED_IMAGES, Math.max(0, source.fields.imageCount))
    }
  };
}

function sanitizeWarnings(warnings: readonly string[]): string[] | undefined {
  const sanitized = warnings
    .slice(0, MAX_LOG_WARNINGS)
    .map((warning) => sanitizeText(warning))
    .filter((warning) => warning.length > 0 && warning !== UNSAFE_CONTENT_PLACEHOLDER);
  return sanitized.length === 0 ? undefined : sanitized;
}

function sanitizeDetails(details: OperationLogDetails): OperationLogDetails | undefined {
  const draft = details.draft === undefined ? undefined : sanitizeDraftSnapshot(details.draft);
  const source = details.source === undefined ? undefined : sanitizeSourceSummary(details.source);
  const warnings = details.warnings === undefined ? undefined : sanitizeWarnings(details.warnings);
  const result = details.result === undefined ? undefined : sanitizeText(details.result);
  const error = details.error === undefined ? undefined : sanitizeText(details.error);
  const sanitized = {
    ...(draft === undefined ? {} : { draft }),
    ...(source === undefined ? {} : { source }),
    ...(warnings === undefined ? {} : { warnings }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error })
  };
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function parseSourceSummary(value: unknown): OperationSourceSummary | undefined {
  if (
    !isRecord(value) ||
    !isProductPlatform(value.platform) ||
    !isBoundedText(value.canonicalUrl, 4_096, false) ||
    !isRecord(value.fields) ||
    typeof value.fields.title !== 'boolean' ||
    typeof value.fields.description !== 'boolean' ||
    typeof value.fields.price !== 'boolean' ||
    typeof value.fields.originalPrice !== 'boolean' ||
    typeof value.fields.imageCount !== 'number' ||
    !Number.isInteger(value.fields.imageCount)
  ) {
    return undefined;
  }
  const imageUrls =
    value.imageUrls === undefined
      ? undefined
      : Array.isArray(value.imageUrls) &&
          value.imageUrls.length <= 100 &&
          value.imageUrls.every((url) => isBoundedText(url, 4_096, false))
        ? value.imageUrls
        : null;
  if (imageUrls === null) {
    return undefined;
  }
  return sanitizeSourceSummary({
    platform: value.platform,
    canonicalUrl: value.canonicalUrl,
    ...(imageUrls === undefined ? {} : { imageUrls }),
    fields: {
      title: value.fields.title,
      description: value.fields.description,
      price: value.fields.price,
      originalPrice: value.fields.originalPrice,
      imageCount: value.fields.imageCount
    }
  });
}

export function sanitizeLogEntry(entry: OperationLogEntry): OperationLogEntry {
  const displayTitle =
    entry.displayTitle === undefined
      ? undefined
      : sanitizeText(entry.displayTitle, MAX_LOG_TITLE_LENGTH);
  const operationLabel =
    entry.operationLabel === undefined
      ? undefined
      : sanitizeText(entry.operationLabel, MAX_LOG_TITLE_LENGTH);
  const code = entry.code === undefined ? undefined : sanitizeText(entry.code, MAX_LOG_CODE_LENGTH);
  const details = entry.details === undefined ? undefined : sanitizeDetails(entry.details);
  return {
    id: sanitizeLogId(entry.id),
    timestamp: sanitizeText(entry.timestamp, 100),
    stage: entry.stage,
    outcome: entry.outcome,
    message: sanitizeText(entry.message),
    ...(displayTitle === undefined ? {} : { displayTitle }),
    ...(operationLabel === undefined ? {} : { operationLabel }),
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details })
  };
}

function parseDraftSnapshot(value: unknown): OperationDraftSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sourceUrl = isBoundedText(value.sourceUrl, 4_096, false) ? value.sourceUrl : undefined;
  const canonicalUrl = isBoundedText(value.canonicalUrl, 4_096, false)
    ? value.canonicalUrl
    : undefined;
  const title = isBoundedText(value.title, MAX_LOG_TITLE_LENGTH) ? value.title : undefined;
  const description = isBoundedText(value.description, MAX_LOG_TEXT_LENGTH)
    ? value.description
    : undefined;
  const price =
    typeof value.price === 'number' && Number.isFinite(value.price) ? value.price : undefined;
  const originalPrice =
    typeof value.originalPrice === 'number' && Number.isFinite(value.originalPrice)
      ? value.originalPrice
      : undefined;
  const shippingMethod = isBoundedText(value.shippingMethod, MAX_LOG_TITLE_LENGTH)
    ? value.shippingMethod
    : undefined;
  const shippingFee =
    typeof value.shippingFee === 'number' && Number.isFinite(value.shippingFee)
      ? value.shippingFee
      : undefined;
  const supportsPickup =
    typeof value.supportsPickup === 'boolean' ? value.supportsPickup : undefined;
  const categoryNote = isBoundedText(value.categoryNote, MAX_LOG_TEXT_LENGTH)
    ? value.categoryNote
    : undefined;
  const selectedImageCount =
    typeof value.selectedImageCount === 'number' && Number.isInteger(value.selectedImageCount)
      ? value.selectedImageCount
      : undefined;
  const videoName = isBoundedText(value.videoName, MAX_LOG_TITLE_LENGTH)
    ? value.videoName
    : undefined;
  return sanitizeDraftSnapshot({
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(price === undefined ? {} : { price }),
    ...(originalPrice === undefined ? {} : { originalPrice }),
    ...(shippingMethod === undefined ? {} : { shippingMethod }),
    ...(shippingFee === undefined ? {} : { shippingFee }),
    ...(supportsPickup === undefined ? {} : { supportsPickup }),
    ...(categoryNote === undefined ? {} : { categoryNote }),
    ...(selectedImageCount === undefined ? {} : { selectedImageCount }),
    ...(videoName === undefined ? {} : { videoName })
  });
}

function parseDetails(value: unknown): OperationLogDetails | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const draft = parseDraftSnapshot(value.draft);
  const source = parseSourceSummary(value.source);
  const warnings =
    Array.isArray(value.warnings) &&
    value.warnings.length <= MAX_LOG_WARNINGS &&
    value.warnings.every((warning) => isBoundedText(warning, MAX_LOG_TEXT_LENGTH))
      ? value.warnings
      : undefined;
  const result = isBoundedText(value.result, MAX_LOG_TEXT_LENGTH) ? value.result : undefined;
  const error = isBoundedText(value.error, MAX_LOG_TEXT_LENGTH) ? value.error : undefined;
  return sanitizeDetails({
    ...(draft === undefined ? {} : { draft }),
    ...(source === undefined ? {} : { source }),
    ...(warnings === undefined ? {} : { warnings }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error })
  });
}

export function parseOperationLogEntry(value: unknown): OperationLogEntry | null {
  if (
    !isRecord(value) ||
    !isBoundedText(value.id, 200, false) ||
    !isBoundedText(value.timestamp, 100, false) ||
    !isOperationStage(value.stage) ||
    !isOperationOutcome(value.outcome) ||
    !isBoundedText(value.message, MAX_LOG_TEXT_LENGTH)
  ) {
    return null;
  }
  const displayTitle = isBoundedText(value.displayTitle, MAX_LOG_TITLE_LENGTH)
    ? value.displayTitle
    : undefined;
  const operationLabel = isBoundedText(value.operationLabel, MAX_LOG_TITLE_LENGTH)
    ? value.operationLabel
    : undefined;
  const code = isBoundedText(value.code, MAX_LOG_CODE_LENGTH) ? value.code : undefined;
  const details = parseDetails(value.details);
  return sanitizeLogEntry({
    id: value.id,
    timestamp: value.timestamp,
    stage: value.stage,
    outcome: value.outcome,
    message: value.message,
    ...(displayTitle === undefined ? {} : { displayTitle }),
    ...(operationLabel === undefined ? {} : { operationLabel }),
    ...(code === undefined ? {} : { code }),
    ...(details === undefined ? {} : { details })
  });
}

export function appendOperationLog(
  existing: readonly OperationLogEntry[],
  entry: OperationLogEntry
): OperationLogEntry[] {
  return [...existing, sanitizeLogEntry(entry)].slice(-MAX_LOG_ENTRIES);
}
