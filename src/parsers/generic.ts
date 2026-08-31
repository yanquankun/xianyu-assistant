import type { ProductPlatform } from '../domain/product';

export type CandidateSource = 'json-ld' | 'open-graph' | 'meta' | 'dom';

export interface ParseCandidate {
  source: CandidateSource;
  platform: ProductPlatform;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  currency?: string;
  images: string[];
}

export interface GenericParseResult {
  candidates: ParseCandidate[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function schemaTypeIncludes(value: unknown, type: string): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase() === type.toLowerCase();
  }
  return Array.isArray(value)
    ? value.some((entry) => typeof entry === 'string' && entry.toLowerCase() === type.toLowerCase())
    : false;
}

function flattenStructuredData(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenStructuredData);
  }
  if (!isRecord(value)) {
    return [];
  }
  const graph = value['@graph'];
  return [value, ...flattenStructuredData(graph)];
}

function parsePrice(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : asString(value);
  if (text === undefined) {
    return undefined;
  }
  const match = /\d+(?:\.\d+)?/u.exec(text.replaceAll(',', ''));
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function readImages(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(readImages);
  }
  if (!isRecord(value)) {
    return [];
  }
  const url = asString(value.url) ?? asString(value.contentUrl);
  return url === undefined ? [] : [url];
}

function readOffer(value: unknown): { price?: number; currency?: string } {
  const offer = Array.isArray(value) ? value.find(isRecord) : value;
  if (!isRecord(offer)) {
    return {};
  }
  const price = parsePrice(offer.price ?? offer.lowPrice);
  const currency = asString(offer.priceCurrency);
  return {
    ...(price === undefined ? {} : { price }),
    ...(currency === undefined ? {} : { currency })
  };
}

function resolveUrl(value: string, pageUrl: string): string | null {
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function getMetaContent(document: Document, selector: string): string | undefined {
  const content = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
  return content === undefined || content.length === 0 ? undefined : content;
}

function getCanonicalUrl(document: Document, pageUrl: string): string {
  const candidate = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const resolved = candidate === undefined ? null : resolveUrl(candidate, pageUrl);
  if (resolved !== null) {
    return resolved;
  }
  const url = new URL(pageUrl);
  url.hash = '';
  return url.href;
}

function parseJsonLd(document: Document, pageUrl: string, platform: ProductPlatform): GenericParseResult {
  const candidates: ParseCandidate[] = [];
  const warnings: string[] = [];
  let malformed = false;

  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const root: unknown = JSON.parse(script.textContent);
      for (const item of flattenStructuredData(root)) {
        if (!schemaTypeIncludes(item['@type'], 'Product')) {
          continue;
        }
        const title = asString(item.name);
        const description = asString(item.description);
        const offer = readOffer(item.offers);
        candidates.push({
          source: 'json-ld',
          platform,
          canonicalUrl: getCanonicalUrl(document, pageUrl),
          ...(title === undefined ? {} : { title }),
          ...(description === undefined ? {} : { description }),
          ...(offer.price === undefined ? {} : { price: offer.price }),
          ...(offer.currency === undefined ? {} : { currency: offer.currency }),
          images: readImages(item.image)
        });
      }
    } catch {
      malformed = true;
    }
  }

  if (malformed) {
    warnings.push('页面结构化商品数据无法解析，已使用页面信息降级');
  }
  return { candidates, warnings };
}

function parseMetadata(document: Document, pageUrl: string, platform: ProductPlatform): ParseCandidate[] {
  const ogImages = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"]')
  )
    .map((meta) => meta.content.trim())
    .filter((value) => value.length > 0);
  const ogTitle = getMetaContent(document, 'meta[property="og:title"]');
  const ogDescription = getMetaContent(document, 'meta[property="og:description"]');
  const ogPrice = parsePrice(
    getMetaContent(document, 'meta[property="product:price:amount"]') ??
      getMetaContent(document, 'meta[property="og:price:amount"]')
  );
  const currency =
    getMetaContent(document, 'meta[property="product:price:currency"]') ??
    getMetaContent(document, 'meta[property="og:price:currency"]');
  const canonicalUrl = getCanonicalUrl(document, pageUrl);

  const candidates: ParseCandidate[] = [];
  if (
    ogTitle !== undefined ||
    ogDescription !== undefined ||
    ogPrice !== undefined ||
    ogImages.length > 0
  ) {
    candidates.push({
      source: 'open-graph',
      platform,
      canonicalUrl,
      ...(ogTitle === undefined ? {} : { title: ogTitle }),
      ...(ogDescription === undefined ? {} : { description: ogDescription }),
      ...(ogPrice === undefined ? {} : { price: ogPrice }),
      ...(currency === undefined ? {} : { currency }),
      images: ogImages
    });
  }

  const pageTitle = document.title.trim();
  if (pageTitle.length > 0) {
    candidates.push({
      source: 'meta',
      platform,
      canonicalUrl,
      title: pageTitle,
      images: []
    });
  }
  return candidates;
}

export function parseGeneric(
  document: Document,
  pageUrl: string,
  platform: ProductPlatform
): GenericParseResult {
  const structured = parseJsonLd(document, pageUrl, platform);
  return {
    candidates: [...structured.candidates, ...parseMetadata(document, pageUrl, platform)],
    warnings: structured.warnings
  };
}

export { parsePrice, resolveUrl };
