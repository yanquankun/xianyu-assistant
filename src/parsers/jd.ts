import { extractAssignedJsonObject } from './embedded-json';
import { createEvidenceSet, type EvidenceContext, type ProductEvidenceSet } from './evidence';
import { parsePrice, resolveUrl } from './generic';
import type { GlyphNameResolver } from './jd-price-font';
import { decodePrivatePrice } from './jd-price-font';

const ID_MISMATCH_WARNING = '京东页面商品标识不一致，已放弃平台专用字段';
const PRICE_DECODE_WARNING = '京东价格使用动态字体且无法可靠解码，请手动填写售价';

export interface JdEvidenceDependencies {
  loadPriceFont(fontUrl: string): Promise<GlyphNameResolver>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(
  record: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  const value = record?.[key];
  return isRecord(value) ? value : null;
}

function textValue(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function textFrom(document: Document, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    const value = (element?.innerText ?? element?.textContent)?.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readAssignedState(
  document: Document,
  variableName: 'window._itemOnly' | 'window._itemInfo'
): { value: Record<string, unknown> | null; malformed: boolean } {
  let malformed = false;
  for (const script of document.querySelectorAll<HTMLScriptElement>('script')) {
    try {
      const value = extractAssignedJsonObject(script.textContent, variableName);
      if (value !== null) {
        return { value, malformed };
      }
    } catch {
      malformed = true;
    }
  }
  return { value: null, malformed };
}

function itemImageValues(item: Record<string, unknown> | null): string[] {
  const images = item?.image;
  return Array.isArray(images)
    ? images.flatMap((image) =>
        typeof image === 'string' && image.trim().length > 0 ? [image.trim()] : []
      )
    : [];
}

function normalizeImageKey(value: string, pageUrl: string): string | null {
  const rawPath = value.split(/[?#]/u, 1)[0];
  const resolved = rawPath === undefined || /^\/?jfs\//u.test(rawPath) ? null : resolveUrl(value, pageUrl);
  const pathname = resolved === null ? rawPath : new URL(resolved).pathname;
  if (pathname === undefined || pathname.length === 0) {
    return null;
  }
  const normalized = `/${pathname.replace(/^\/+|^n\d+\/(?:s\d+x\d+_)?/u, '')}`.replace(
    /^\/(?:n\d+\/)?(?:s\d+x\d+_)?(?=jfs\/)/u,
    '/'
  );
  return normalized.startsWith('/jfs/') ? normalized : null;
}

function normalizeJdImageUrl(value: string, pageUrl: string): string | null {
  let resolved: string | null;
  if (value.startsWith('jfs/')) {
    resolved = `https://img10.360buyimg.com/n1/${value}`;
  } else if (value.startsWith('/jfs/')) {
    resolved = `https://img10.360buyimg.com/n1${value}`;
  } else {
    resolved = resolveUrl(value, pageUrl);
  }
  if (resolved === null) {
    return null;
  }
  const url = new URL(resolved);
  const host = url.hostname.toLowerCase();
  if (host !== '360buyimg.com' && !host.endsWith('.360buyimg.com')) {
    return null;
  }
  return url.href;
}

function collectGalleryImages(
  document: Document,
  itemImages: readonly string[],
  context: EvidenceContext,
  evidence: ProductEvidenceSet,
  binding: { productId?: string; skuId?: string }
): void {
  const allowedKeys = new Set(
    itemImages.flatMap((image) => {
      const key = normalizeImageKey(image, context.pageUrl);
      return key === null ? [] : [key];
    })
  );
  if (allowedKeys.size === 0) {
    return;
  }
  const gallery = document.querySelector('#loopImgUl');
  if (gallery === null) {
    itemImages.slice(0, 9).forEach((image, position) => {
      const url = normalizeJdImageUrl(image, context.pageUrl);
      if (url !== null) {
        evidence.images.push({
          value: url,
          source: 'platform-gallery',
          confidence: 'high',
          position,
          ...binding
        });
      }
    });
    return;
  }
  let position = 0;
  for (const item of gallery.querySelectorAll('li')) {
    const type = item.getAttribute('data-type')?.toLowerCase();
    if (type === 'video' || item.matches('[class*="video" i]')) {
      continue;
    }
    const image = item.querySelector<HTMLImageElement>('img');
    const rawUrl =
      image?.getAttribute('back_src') ??
      image?.getAttribute('data-lazy-img') ??
      image?.getAttribute('data-src') ??
      image?.getAttribute('src');
    if (rawUrl === null || rawUrl === undefined) {
      continue;
    }
    const key = normalizeImageKey(rawUrl, context.pageUrl);
    const url = normalizeJdImageUrl(rawUrl, context.pageUrl);
    if (key === null || !allowedKeys.has(key) || url === null) {
      continue;
    }
    evidence.images.push({
      value: url,
      source: 'platform-gallery',
      confidence: 'high',
      position,
      ...binding
    });
    position += 1;
    if (position === 9) {
      break;
    }
  }
}

function parseAsciiPrice(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /[¥￥]\s*(\d[\d,]*(?:\.\d{1,2})?)/u.exec(value);
  if (match?.[1] !== undefined) {
    return parsePrice(match[1]);
  }
  return /^\s*\d[\d,]*(?:\.\d{1,2})?\s*$/u.test(value) ? parsePrice(value) : undefined;
}

function fontFaceUrlFromCss(cssText: string, fontFamily: string): string | null {
  for (const match of cssText.matchAll(/@font-face\s*\{([^}]*)\}/giu)) {
    const block = match[1];
    if (block === undefined) {
      continue;
    }
    const family = /font-family\s*:\s*(['"]?)([^;'"}]+)\1\s*;?/iu.exec(block)?.[2]?.trim();
    if (family !== fontFamily) {
      continue;
    }
    const url = /src\s*:[^;]*url\(\s*(['"]?)(https:[^)'"\s]+)\1\s*\)/iu.exec(block)?.[2];
    if (url !== undefined) {
      return url;
    }
  }
  return null;
}

function findFontUrl(document: Document, fontFamily: string): string | null {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const result = fontFaceUrlFromCss(rule.cssText, fontFamily);
        if (result !== null) {
          return result;
        }
      }
    } catch {
      // Cross-origin stylesheets are intentionally ignored.
    }
  }
  for (const style of document.querySelectorAll<HTMLStyleElement>('style')) {
    const result = fontFaceUrlFromCss(style.textContent, fontFamily);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

async function readSalePrice(
  document: Document,
  priceFloor: Record<string, unknown> | null,
  dependencies: JdEvidenceDependencies,
  warnings: string[]
): Promise<number | undefined> {
  const domPrice = parseAsciiPrice(textFrom(document, ['#main_price']));
  if (domPrice !== undefined && domPrice > 0) {
    return domPrice;
  }
  const statePrice = textValue(priceFloor, 'price');
  const asciiStatePrice = parseAsciiPrice(statePrice);
  if (asciiStatePrice !== undefined && asciiStatePrice > 0) {
    return asciiStatePrice;
  }
  if (statePrice === undefined) {
    return undefined;
  }
  const fontFamily = textValue(priceFloor, 'fontFamily');
  const fontUrl = fontFamily === undefined ? null : findFontUrl(document, fontFamily);
  if (fontUrl === null) {
    warnings.push(PRICE_DECODE_WARNING);
    return undefined;
  }
  try {
    const resolver = await dependencies.loadPriceFont(fontUrl);
    const decoded = decodePrivatePrice(statePrice, resolver);
    if (decoded === null) {
      warnings.push(PRICE_DECODE_WARNING);
      return undefined;
    }
    return decoded;
  } catch {
    warnings.push(PRICE_DECODE_WARNING);
    return undefined;
  }
}

function readOriginalPrice(
  priceFloor: Record<string, unknown> | null,
  salePrice: number | undefined
): number | undefined {
  if (salePrice === undefined) {
    return undefined;
  }
  const ext = recordValue(priceFloor, 'ext');
  const realPriceExt = recordValue(ext, 'realPriceExt');
  const original = recordValue(realPriceExt, 'ORIGINAL');
  const originalPrice = parseAsciiPrice(textValue(original, 'salePrice'));
  const jdPrice = parseAsciiPrice(textValue(ext, 'jdPrice'));
  if (
    originalPrice === undefined ||
    (jdPrice !== undefined && jdPrice !== originalPrice) ||
    originalPrice <= salePrice
  ) {
    return undefined;
  }
  return originalPrice;
}

export async function collectJdEvidence(
  document: Document,
  context: EvidenceContext,
  dependencies: JdEvidenceDependencies
): Promise<ProductEvidenceSet> {
  const evidence = createEvidenceSet();
  const itemOnlyState = readAssignedState(document, 'window._itemOnly');
  const itemInfoState = readAssignedState(document, 'window._itemInfo');
  if (itemOnlyState.malformed || itemInfoState.malformed) {
    evidence.warnings.push('京东页面内嵌商品数据无法解析，已使用页面信息降级');
  }
  const item = recordValue(itemOnlyState.value, 'item');
  const stock = recordValue(itemInfoState.value, 'stock');
  const priceFloor = recordValue(itemInfoState.value, 'priceFloor');
  const itemSkuId = textValue(item, 'skuId');
  const stockSkuId = textValue(stock, 'skuId');
  const realSkuId = textValue(stock, 'realSkuId');
  const explicitIds = [context.productId, itemSkuId, stockSkuId, realSkuId].filter(
    (value): value is string => value !== undefined
  );
  if (new Set(explicitIds).size > 1) {
    return { ...createEvidenceSet(), warnings: [ID_MISMATCH_WARNING] };
  }
  const currentSkuId = stockSkuId ?? itemSkuId ?? context.skuId ?? context.productId;
  const binding = {
    ...(context.productId === undefined ? {} : { productId: context.productId }),
    ...(currentSkuId === undefined ? {} : { skuId: currentSkuId })
  };
  const embeddedTitle = textValue(item, 'skuName');
  const fallbackTitle = textFrom(document, ['.sku-name', 'h1']);
  if (embeddedTitle !== undefined) {
    evidence.titles.push({
      value: embeddedTitle,
      source: 'embedded-state',
      confidence: 'high',
      ...binding
    });
  } else if (fallbackTitle !== undefined) {
    evidence.titles.push({
      value: fallbackTitle,
      source: 'semantic-dom',
      confidence: 'medium',
      ...binding
    });
  }

  const salePrice = await readSalePrice(document, priceFloor, dependencies, evidence.warnings);
  const conditionLabel = textValue(recordValue(priceFloor, 'afterDesc'), 'text');
  if (salePrice !== undefined) {
    evidence.prices.push({
      value: salePrice,
      currency: 'CNY',
      kind: conditionLabel?.includes('到手价') === true ? 'conditional' : 'sale',
      source: priceFloor === null ? 'semantic-dom' : 'embedded-state',
      confidence: priceFloor === null ? 'medium' : 'high',
      ...(conditionLabel === undefined ? {} : { label: conditionLabel }),
      ...binding
    });
  }
  const originalPrice = readOriginalPrice(priceFloor, salePrice);
  if (originalPrice !== undefined) {
    evidence.prices.push({
      value: originalPrice,
      currency: 'CNY',
      kind: 'original',
      source: 'embedded-state',
      confidence: 'high',
      ...binding
    });
  }
  collectGalleryImages(document, itemImageValues(item), context, evidence, binding);
  return evidence;
}
