import type { ProductPlatform } from './product';

export type ProductDomainFamily = 'taobao-family' | 'jd-family' | 'generic';

export interface ProductHostClassification {
  platformHint: ProductPlatform;
  domainFamily: ProductDomainFamily;
  isShortLink: boolean;
}

export interface ProductIdentity {
  platform: Exclude<ProductPlatform, 'generic'>;
  productId: string;
  skuId?: string;
  canonicalUrl: string;
}

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifyProductHost(hostname: string): ProductHostClassification {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (host === 'e.tb.cn') {
    return {
      platformHint: 'taobao',
      domainFamily: 'taobao-family',
      isShortLink: true
    };
  }
  if (isHostOrSubdomain(host, 'taobao.com')) {
    return {
      platformHint: 'taobao',
      domainFamily: 'taobao-family',
      isShortLink: false
    };
  }
  if (isHostOrSubdomain(host, 'tmall.com')) {
    return {
      platformHint: 'tmall',
      domainFamily: 'taobao-family',
      isShortLink: false
    };
  }
  if (host === '3.cn') {
    return { platformHint: 'jd', domainFamily: 'jd-family', isShortLink: true };
  }
  if (isHostOrSubdomain(host, 'jd.com')) {
    return { platformHint: 'jd', domainFamily: 'jd-family', isShortLink: false };
  }
  return { platformHint: 'generic', domainFamily: 'generic', isShortLink: false };
}

function parseHttpUrl(input: string | URL): URL | null {
  try {
    const url = input instanceof URL ? new URL(input.href) : new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function validDigits(value: string | null): string | undefined {
  return value !== null && /^\d+$/u.test(value) ? value : undefined;
}

function optionalSkuId(url: URL): string | undefined {
  return validDigits(url.searchParams.get('skuId')) ?? validDigits(url.searchParams.get('sku_id'));
}

function buildAlibabaIdentity(url: URL, platform: 'taobao' | 'tmall'): ProductIdentity | null {
  if (url.pathname.toLowerCase() !== '/item.htm') {
    return null;
  }
  const productId = validDigits(url.searchParams.get('id'));
  if (productId === undefined) {
    return null;
  }
  const skuId = optionalSkuId(url);
  const canonical = new URL('/item.htm', url.origin);
  canonical.searchParams.set('id', productId);
  if (skuId !== undefined) {
    canonical.searchParams.set('skuId', skuId);
  }
  return {
    platform,
    productId,
    ...(skuId === undefined ? {} : { skuId }),
    canonicalUrl: canonical.href
  };
}

function buildJdIdentity(url: URL): ProductIdentity | null {
  const host = url.hostname.toLowerCase();
  if (host === 'item.m.jd.com' && url.pathname === '/ware/view.action') {
    const productId = validDigits(url.searchParams.get('wareId'));
    if (productId === undefined) {
      return null;
    }
    const canonical = new URL('/ware/view.action', url.origin);
    canonical.searchParams.set('wareId', productId);
    return {
      platform: 'jd',
      productId,
      canonicalUrl: canonical.href
    };
  }
  const productMatch =
    host === 'item.jd.com'
      ? /^\/(\d+)\.html$/u.exec(url.pathname)
      : host === 'item.m.jd.com'
        ? /^\/product\/(\d+)\.html$/u.exec(url.pathname)
        : null;
  const productId = productMatch?.[1];
  if (productId === undefined) {
    return null;
  }
  return {
    platform: 'jd',
    productId,
    canonicalUrl: `${url.origin}${url.pathname}`
  };
}

export function parseProductIdentity(input: string | URL): ProductIdentity | null {
  const url = parseHttpUrl(input);
  if (url === null) {
    return null;
  }
  const classification = classifyProductHost(url.hostname);
  if (classification.isShortLink) {
    return null;
  }
  if (classification.platformHint === 'taobao' || classification.platformHint === 'tmall') {
    return buildAlibabaIdentity(url, classification.platformHint);
  }
  return classification.platformHint === 'jd' ? buildJdIdentity(url) : null;
}

export function sameProductIdentity(left: ProductIdentity, right: ProductIdentity): boolean {
  if (left.platform !== right.platform || left.productId !== right.productId) {
    return false;
  }
  return left.skuId === undefined || right.skuId === undefined || left.skuId === right.skuId;
}

function isSensitiveLogParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    /^(?:authorization|auth|token|access_token|api[_-]?key|key|password|passwd|secret|cookie|session|sid)$/u.test(
      normalized
    ) ||
    /^(?:utm_|spm$|scm$|jkl$|tk$|share|track|trace|ref(?:errer|erral)?$)/u.test(normalized)
  );
}

export function sanitizeProductLogUrl(input: string): string | undefined {
  const url = parseHttpUrl(input.trim());
  if (url === null) {
    return undefined;
  }
  const identity = parseProductIdentity(url);
  if (identity !== null) {
    return identity.canonicalUrl;
  }
  const classification = classifyProductHost(url.hostname);
  if (classification.isShortLink) {
    url.search = '';
    return url.href;
  }
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitiveLogParameter(name)) {
      url.searchParams.delete(name);
    }
  }
  return url.href;
}
