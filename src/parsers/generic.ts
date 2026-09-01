import {
  createEvidenceSet,
  type EvidenceContext,
  type FieldEvidence,
  type ImageEvidence,
  type PriceEvidence,
  type ProductEvidenceSet
} from './evidence';

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
  return [value, ...flattenStructuredData(value['@graph'])];
}

export function parsePrice(value: unknown): number | undefined {
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
    return value.trim().length === 0 ? [] : [value.trim()];
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
  const currency = asString(offer.priceCurrency)?.toUpperCase();
  return {
    ...(price === undefined ? {} : { price }),
    ...(currency === undefined ? {} : { currency })
  };
}

export function resolveUrl(value: string, pageUrl: string): string | null {
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function getMetaContent(document: Document, selector: string): string | undefined {
  const content = document.querySelector<HTMLMetaElement>(selector)?.content.trim();
  return content === undefined || content.length === 0 ? undefined : content;
}

function getCanonicalEvidence(
  document: Document,
  context: EvidenceContext
): FieldEvidence<string> | null {
  const candidate = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const resolved = candidate === undefined ? null : resolveUrl(candidate, context.pageUrl);
  return resolved === null
    ? null
    : { value: resolved, source: 'meta', confidence: 'medium', label: 'canonical' };
}

function pushTextEvidence(
  target: FieldEvidence<string>[],
  value: string | undefined,
  source: FieldEvidence<string>['source'],
  confidence: FieldEvidence<string>['confidence'],
  extra: Pick<FieldEvidence<string>, 'label' | 'productId' | 'skuId'> = {}
): void {
  if (value !== undefined) {
    target.push({ value, source, confidence, ...extra });
  }
}

function pushCnyPrice(
  target: PriceEvidence[],
  price: number | undefined,
  currency: string | undefined,
  source: PriceEvidence['source'],
  confidence: PriceEvidence['confidence'],
  extra: Pick<PriceEvidence, 'productId' | 'skuId'> = {}
): void {
  if (price !== undefined && (currency === undefined || currency === 'CNY')) {
    target.push({ value: price, currency: 'CNY', kind: 'sale', source, confidence, ...extra });
  }
}

function pushImages(
  target: ImageEvidence[],
  values: readonly string[],
  source: ImageEvidence['source'],
  confidence: ImageEvidence['confidence'],
  startPosition = 0,
  extra: Pick<ImageEvidence, 'productId' | 'skuId'> = {}
): void {
  values.forEach((value, index) => {
    target.push({ value, source, confidence, position: startPosition + index, ...extra });
  });
}

function collectJsonLd(document: Document, evidence: ProductEvidenceSet): void {
  let malformed = false;
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]'
  )) {
    try {
      const root: unknown = JSON.parse(script.textContent);
      for (const item of flattenStructuredData(root)) {
        if (!schemaTypeIncludes(item['@type'], 'Product')) {
          continue;
        }
        const productId = asString(item.productID);
        const skuId = asString(item.sku);
        const binding = {
          ...(productId === undefined ? {} : { productId }),
          ...(skuId === undefined ? {} : { skuId })
        };
        pushTextEvidence(evidence.titles, asString(item.name), 'json-ld', 'high', binding);
        pushTextEvidence(
          evidence.descriptions,
          asString(item.description),
          'json-ld',
          'high',
          binding
        );
        const offer = readOffer(item.offers);
        pushCnyPrice(
          evidence.prices,
          offer.price,
          offer.currency,
          'json-ld',
          'high',
          binding
        );
        pushImages(
          evidence.images,
          readImages(item.image),
          'json-ld',
          'high',
          evidence.images.length,
          binding
        );
      }
    } catch {
      malformed = true;
    }
  }
  if (malformed) {
    evidence.warnings.push('页面结构化商品数据无法解析，已使用页面信息降级');
  }
}

function collectMetadata(document: Document, evidence: ProductEvidenceSet): void {
  const ogTitle = getMetaContent(document, 'meta[property="og:title"]');
  const ogDescription = getMetaContent(document, 'meta[property="og:description"]');
  const ogPrice = parsePrice(
    getMetaContent(document, 'meta[property="product:price:amount"]') ??
      getMetaContent(document, 'meta[property="og:price:amount"]')
  );
  const ogCurrency = (
    getMetaContent(document, 'meta[property="product:price:currency"]') ??
    getMetaContent(document, 'meta[property="og:price:currency"]')
  )?.toUpperCase();
  const ogImages = Array.from(
    document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"]')
  )
    .map((meta) => meta.content.trim())
    .filter((value) => value.length > 0);

  pushTextEvidence(evidence.titles, ogTitle, 'open-graph', 'medium');
  pushTextEvidence(evidence.descriptions, ogDescription, 'open-graph', 'medium');
  pushCnyPrice(evidence.prices, ogPrice, ogCurrency, 'open-graph', 'medium');
  pushImages(evidence.images, ogImages, 'open-graph', 'medium', evidence.images.length);
  pushTextEvidence(
    evidence.descriptions,
    getMetaContent(document, 'meta[name="description"]'),
    'meta',
    'medium'
  );
  const pageTitle = document.title.trim();
  pushTextEvidence(
    evidence.titles,
    pageTitle.length === 0 ? undefined : pageTitle,
    'meta',
    'low',
    { label: 'page-title' }
  );
}

function semanticValue(element: Element): string | undefined {
  const attribute =
    element.getAttribute('content') ?? element.getAttribute('src') ?? element.getAttribute('href');
  const value = (attribute ?? element.textContent).trim();
  return value.length === 0 ? undefined : value;
}

function collectSemanticDom(document: Document, evidence: ProductEvidenceSet): void {
  const name = document.querySelector('[itemprop~="name"]');
  pushTextEvidence(
    evidence.titles,
    name === null ? undefined : semanticValue(name),
    'semantic-dom',
    'medium'
  );
  const description = document.querySelector('[itemprop~="description"]');
  pushTextEvidence(
    evidence.descriptions,
    description === null ? undefined : semanticValue(description),
    'semantic-dom',
    'medium'
  );
  const price = document.querySelector('[itemprop~="price"]');
  pushCnyPrice(
    evidence.prices,
    price === null ? undefined : parsePrice(semanticValue(price)),
    price?.getAttribute('currency')?.toUpperCase() ??
      price?.getAttribute('data-currency')?.toUpperCase(),
    'semantic-dom',
    'medium'
  );
  const imageValues = Array.from(document.querySelectorAll('[itemprop~="image"]')).flatMap(
    (element) => {
      const value = semanticValue(element);
      return value === undefined ? [] : [value];
    }
  );
  pushImages(evidence.images, imageValues, 'semantic-dom', 'medium', evidence.images.length);
}

export function collectGenericEvidence(
  document: Document,
  context: EvidenceContext
): ProductEvidenceSet {
  const evidence = createEvidenceSet();
  collectJsonLd(document, evidence);
  collectMetadata(document, evidence);
  collectSemanticDom(document, evidence);
  const canonical = getCanonicalEvidence(document, context);
  if (canonical !== null) {
    evidence.canonicalUrls.push(canonical);
  }
  return evidence;
}
