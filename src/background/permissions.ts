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
