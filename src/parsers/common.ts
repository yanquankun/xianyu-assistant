import { normalizeHttpUrl } from '../background/permissions';
import type {
  ParsedProduct,
  ProductExtractionError,
  ProductExtractionResponse,
  ProductPlatform
} from '../domain/product';
import { parseGeneric } from './generic';
import { parseJdDom } from './jd';
import { mergeProductCandidates } from './merge';
import { parseTaobaoDom } from './taobao';

const PAGE_ERROR_PATTERNS = [
  { pattern: /页面不存在/u, code: 'PAGE_ERROR' },
  { pattern: /访问出错/u, code: 'PAGE_ERROR' },
  { pattern: /系统繁忙/u, code: 'PAGE_ERROR' }
] as const;

const VERIFICATION_PATTERN = /(?:登录|验证码|安全验证|风险验证|访问验证|captcha|verify)/iu;
const VERIFICATION_BODY_PATTERN =
  /(?:请输入验证码|完成安全验证|访问风险[^\n]{0,40}完成验证|扫码登录|captcha|verify)/iu;

export function detectProductPageError(
  document: Document,
  pageUrl: string
): ProductExtractionError | null {
  const title = document.title.trim();
  const bodyText = document.body.textContent.trim().slice(0, 20_000);
  const pageText = `${title}\n${bodyText}`;
  const status = /\b(?:HTTP\s+Status\s+)?(400|403|404|500)\b/iu.exec(pageText)?.[1];
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
  return platform === 'taobao' && pathname === '/item.htm';
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

export function parseProductDocument(document: Document, pageUrl: string): ParsedProduct {
  const pageError = detectProductPageError(document, pageUrl);
  if (pageError !== null) {
    throw new Error(pageError.message);
  }
  const normalized = normalizeHttpUrl(pageUrl);
  const generic = parseGeneric(document, normalized.href, normalized.platform);
  const platformCandidate =
    normalized.platform === 'taobao'
      ? parseTaobaoDom(document)
      : normalized.platform === 'jd'
        ? parseJdDom(document)
        : null;
  const candidates =
    platformCandidate === null
      ? generic.candidates
      : [...generic.candidates, platformCandidate];
  return {
    ...mergeProductCandidates(candidates, normalized.href, generic.warnings),
    platform: normalized.platform
  };
}

export function extractProductDocument(
  document: Document,
  pageUrl: string,
  hintedTitle?: string
): ProductExtractionResponse {
  const pageError = detectProductPageError(document, pageUrl);
  if (pageError !== null) {
    return { ok: false, error: pageError };
  }
  const product = parseProductDocument(document, pageUrl);
  return { ok: true, product: withHintedTitle(product, pageUrl, hintedTitle) };
}
