import type { ProductPlatform } from '../domain/product';

export interface NormalizedUrl {
  url: URL;
  href: string;
  platform: ProductPlatform;
}

function classifyPlatform(hostname: string): ProductPlatform {
  const host = hostname.toLowerCase();
  if (
    host === 'taobao.com' ||
    host.endsWith('.taobao.com') ||
    host === 'tmall.com' ||
    host.endsWith('.tmall.com')
  ) {
    return 'taobao';
  }
  if (host === 'jd.com' || host.endsWith('.jd.com')) {
    return 'jd';
  }
  return 'generic';
}

export function normalizeHttpUrl(input: string): NormalizedUrl {
  const value = input.trim();
  if (value.length === 0) {
    throw new Error('请输入完整商品链接');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入有效的完整商品链接');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 HTTP 或 HTTPS 商品链接');
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  return {
    url,
    href: url.href,
    platform: classifyPlatform(url.hostname)
  };
}

export function getRequestedOrigin(url: URL): string {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 HTTP 或 HTTPS 来源权限');
  }
  return `${url.protocol}//${url.host}/*`;
}

export function ensureProductDestination(source: NormalizedUrl, destination: string): void {
  const finalUrl = normalizeHttpUrl(destination);
  if (source.platform !== 'generic' && finalUrl.platform !== source.platform) {
    throw new Error('商品页跳转到了不受支持的站点，请先在浏览器中打开商品页');
  }
  const hostname = finalUrl.url.hostname.toLowerCase();
  const pathname = finalUrl.url.pathname.toLowerCase();
  const verificationHost = /(^|\.)(login|passport|verify|captcha|sec)\./u.test(hostname);
  const verificationPath = /\/(login|verify|captcha)(\/|\.|$)/u.test(pathname);
  if (verificationHost || verificationPath) {
    throw new Error('商品页跳转到了登录或验证页面，请先在浏览器中完成验证');
  }
}
