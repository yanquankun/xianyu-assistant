import type { ParsedProduct, ProductImage } from '../domain/product';
import type { CandidateSource, ParseCandidate } from './generic';
import { resolveUrl } from './generic';

const SOURCE_PRIORITY: Record<CandidateSource, number> = {
  'json-ld': 4,
  'open-graph': 3,
  meta: 2,
  dom: 1
};

const MAX_PRODUCT_IMAGES = 20;

function firstDefined<T>(candidates: readonly ParseCandidate[], read: (candidate: ParseCandidate) => T | undefined): T | undefined {
  for (const candidate of candidates) {
    const value = read(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function imageIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function mergeImages(candidates: readonly ParseCandidate[], pageUrl: string): ProductImage[] {
  const seen = new Set<string>();
  const images: ProductImage[] = [];
  for (const candidate of candidates) {
    for (const rawUrl of candidate.images) {
      const url = resolveUrl(rawUrl, pageUrl);
      if (url === null) {
        continue;
      }
      const identity = imageIdentity(url);
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      images.push({
        id: `image-${String(images.length + 1)}`,
        location: {
          kind: 'remote',
          url,
          extractedBy: candidate.source
        },
        selected: images.length < 9,
        loadStatus: 'idle'
      });
      if (images.length === MAX_PRODUCT_IMAGES) {
        return images;
      }
    }
  }
  return images;
}

export function mergeProductCandidates(
  input: readonly ParseCandidate[],
  pageUrl: string,
  inheritedWarnings: readonly string[]
): ParsedProduct {
  const candidates = [...input].sort(
    (left, right) => SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source]
  );
  const title =
    firstDefined(candidates, (candidate) => {
      const value = candidate.title?.trim();
      return value === undefined || value.length === 0 ? undefined : value;
    }) ?? '';
  const description =
    firstDefined(candidates, (candidate) => {
      const value = candidate.description?.trim();
      return value === undefined || value.length === 0 ? undefined : value;
    }) ?? '';
  const price = firstDefined(candidates, (candidate) => candidate.price) ?? null;
  const originalPrice = firstDefined(candidates, (candidate) => candidate.originalPrice);
  const currency = firstDefined(candidates, (candidate) => candidate.currency) ?? 'CNY';
  const canonicalUrl = firstDefined(candidates, (candidate) => candidate.canonicalUrl) ?? pageUrl;
  const platform = candidates.at(0)?.platform ?? 'generic';
  const images = mergeImages(candidates, pageUrl);
  const warnings = [...inheritedWarnings];

  if (title.length === 0) {
    warnings.push('未能识别商品标题，请手动填写');
  }
  if (price === null) {
    warnings.push('未能识别商品价格，请手动填写');
  }
  if (images.length === 0) {
    warnings.push('未能识别商品图片，请手动补充');
  }

  const hasStructuredCore = candidates.some(
    (candidate) =>
      candidate.source === 'json-ld' &&
      candidate.title !== undefined &&
      candidate.price !== undefined &&
      candidate.images.length > 0
  );
  const confidence = hasStructuredCore
    ? 'high'
    : title.length > 0 && (price !== null || images.length > 0)
      ? 'medium'
      : 'low';

  return {
    platform,
    canonicalUrl,
    title,
    description,
    price,
    ...(originalPrice === undefined ? {} : { originalPrice }),
    currency,
    images,
    warnings,
    confidence
  };
}
