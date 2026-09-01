import { normalizeHttpUrl } from '../background/permissions';
import type {
  ParsedProduct,
  ProductExtractionError,
  ProductExtractionResponse,
  ProductPlatform
} from '../domain/product';
import { parseProductIdentity } from '../domain/product-url';
import { createEvidenceSet, mergeEvidenceSets, type EvidenceContext } from './evidence';
import { collectGenericEvidence } from './generic';
import { collectJdEvidence } from './jd';
import { createOpenTypeGlyphResolver } from './jd-price-font';
import { mergeProductEvidence } from './merge';
import { collectTaobaoEvidence } from './taobao';
import { collectTmallEvidence } from './tmall';

const PAGE_ERROR_PATTERNS = [
  { pattern: /页面不存在/u, code: 'PAGE_ERROR' },
  { pattern: /访问出错/u, code: 'PAGE_ERROR' },
  { pattern: /系统繁忙/u, code: 'PAGE_ERROR' }
] as const;

const VERIFICATION_PATTERN = /(?:登录|验证码|安全验证|风险验证|访问验证|captcha|verify)/iu;
const VERIFICATION_BODY_PATTERN =
  /(?:请输入验证码|完成安全验证|访问风险[^\n]{0,40}完成验证|扫码登录|captcha|verify)/iu;

export interface ProductParserDependencies {
  fetch: typeof fetch;
}

const DEFAULT_DEPENDENCIES: ProductParserDependencies = { fetch: globalThis.fetch };

function detectExplicitHttpStatus(value: string): string | undefined {
  const explicitStatus = /\bHTTP(?:\s+Status)?\s+(400|403|404|500)\b/iu.exec(value)?.[1];
  if (explicitStatus !== undefined) {
    return explicitStatus;
  }
  return /\b(400|403|404|500)\s*(?:[-–—:]\s*)?(?:Bad Request|Forbidden|Not Found|Internal Server Error)\b/iu.exec(
    value
  )?.[1];
}

export function detectProductPageError(
  document: Document,
  pageUrl: string
): ProductExtractionError | null {
  const title = document.title.trim();
  const bodyText = document.body.textContent.trim().slice(0, 20_000);
  const pageText = `${title}\n${bodyText}`;
  const status = detectExplicitHttpStatus(pageText);
  if (status !== undefined) {
    return { message: `商品页面返回 HTTP ${status} 错误`, code: `HTTP_${status}` };
  }
  for (const pageError of PAGE_ERROR_PATTERNS) {
    if (pageError.pattern.test(pageText)) {
      return { message: '商品页面当前不可用，请稍后重试', code: pageError.code };
    }
  }
  const normalized = normalizeHttpUrl(pageUrl);
  if (
    /\/(?:login|verify|captcha|risk|security|error)(?:\/|\.|$)/iu.test(
      normalized.url.pathname
    ) ||
    /(?:^|\.)(?:login|passport|verify|captcha|sec|security|risk|auth)\./iu.test(
      normalized.url.hostname
    ) ||
    VERIFICATION_PATTERN.test(title) ||
    VERIFICATION_BODY_PATTERN.test(bodyText)
  ) {
    return { message: '商品页面需要登录或安全验证', code: 'VERIFICATION_REQUIRED' };
  }
  return null;
}

function isKnownProductRoute(platform: ProductPlatform, pageUrl: string): boolean {
  const url = normalizeHttpUrl(pageUrl).url;
  const pathname = url.pathname.toLowerCase();
  if (platform === 'jd') {
    return /^\/product\/[^/]+\.html$/u.test(pathname) ||
      (url.hostname.toLowerCase() === 'item.jd.com' && /^\/[^/]+\.html$/u.test(pathname));
  }
  return (platform === 'taobao' || platform === 'tmall') && pathname === '/item.htm';
}

function withHintedTitle(
  product: ParsedProduct,
  pageUrl: string,
  hintedTitle: string | undefined
): ParsedProduct {
  const title = hintedTitle?.trim();
  if (
    product.title.trim().length > 0 ||
    title === undefined ||
    title.length === 0 ||
    !isKnownProductRoute(product.platform, pageUrl)
  ) {
    return product;
  }
  return {
    ...product,
    title,
    warnings: [
      ...product.warnings.filter((warning) => warning !== '未能识别商品标题，请手动填写'),
      '标题来自分享文案，请核对'
    ]
  };
}

function applyExtractionQualityGate(product: ParsedProduct): ProductExtractionResponse {
  if (product.title.trim().length === 0) {
    return {
      ok: false,
      error: { code: 'TITLE_MISSING', message: '未能可靠识别商品标题，请重试或手动填写' }
    };
  }
  if (product.price === null && product.images.length === 0) {
    return {
      ok: false,
      error: {
        code: 'PRODUCT_INCOMPLETE',
        message: '仅识别到商品标题，售价和商品图均缺失，请重试或手动填写'
      }
    };
  }
  const warnings = product.warnings.filter(
    (warning) =>
      warning !== '未能识别商品价格，请手动填写' &&
      warning !== '未能识别商品图片，请手动补充'
  );
  if (product.price === null) {
    warnings.push('未能可靠识别售价，请手动填写');
  }
  if (product.images.length === 0) {
    warnings.push('未能可靠识别商品图片，请手动补充');
  }
  return { ok: true, product: { ...product, warnings: [...new Set(warnings)] } };
}

export async function parseProductDocument(
  document: Document,
  pageUrl: string,
  dependencies: ProductParserDependencies = DEFAULT_DEPENDENCIES
): Promise<ParsedProduct> {
  const pageError = detectProductPageError(document, pageUrl);
  if (pageError !== null) {
    throw new Error(pageError.message);
  }
  const normalized = normalizeHttpUrl(pageUrl);
  const identity = parseProductIdentity(normalized.url);
  const context: EvidenceContext = {
    platform: normalized.platform,
    pageUrl: identity?.canonicalUrl ?? normalized.href,
    ...(identity?.productId === undefined ? {} : { productId: identity.productId }),
    ...(identity?.skuId === undefined ? {} : { skuId: identity.skuId })
  };
  const generic = collectGenericEvidence(document, context);
  const platformEvidence =
    context.platform === 'taobao'
      ? collectTaobaoEvidence(document, context)
      : context.platform === 'tmall'
        ? collectTmallEvidence(document, context)
        : context.platform === 'jd'
          ? await collectJdEvidence(document, context, {
              loadPriceFont: (fontUrl) => createOpenTypeGlyphResolver(fontUrl, dependencies.fetch)
            })
          : createEvidenceSet();
  return mergeProductEvidence(mergeEvidenceSets(generic, platformEvidence), context);
}

export async function extractProductDocument(
  document: Document,
  pageUrl: string,
  hintedTitle?: string,
  dependencies: ProductParserDependencies = DEFAULT_DEPENDENCIES
): Promise<ProductExtractionResponse> {
  const pageError = detectProductPageError(document, pageUrl);
  if (pageError !== null) {
    return { ok: false, error: pageError };
  }
  const product = await parseProductDocument(document, pageUrl, dependencies);
  return applyExtractionQualityGate(withHintedTitle(product, pageUrl, hintedTitle));
}
