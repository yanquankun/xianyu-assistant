import { normalizeHttpUrl } from './permissions';
import type { ProductPlatform } from '../domain/product';

export interface ParsedProductInput {
  submittedUrl: string;
  platformHint: ProductPlatform;
  hintedTitle?: string;
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'()[\]「」]+/iu;
const TRAILING_URL_PUNCTUATION = /[，。；、,.;！？!?：:]+$/u;

function platformFromHost(hostname: string, fallback: ProductPlatform): ProductPlatform {
  const host = hostname.toLowerCase();
  if (host === '3.cn') {
    return 'jd';
  }
  if (host === 'e.tb.cn') {
    return 'taobao';
  }
  return fallback;
}

function firstHintedTitle(input: string): string | undefined {
  for (const match of input.matchAll(/「([^」]*)」/gu)) {
    const title = match[1]?.trim();
    if (title !== undefined && title.length > 0) {
      return title;
    }
  }
  return undefined;
}

export function parseProductInput(input: string): ParsedProductInput {
  const match = HTTP_URL_PATTERN.exec(input);
  if (match === null) {
    throw new Error('分享内容中没有可用的 HTTP(S) 商品链接');
  }
  const rawUrl = match[0].replace(TRAILING_URL_PUNCTUATION, '');
  const normalized = normalizeHttpUrl(rawUrl);
  const hintedTitle = firstHintedTitle(input);
  return {
    submittedUrl: normalized.href,
    platformHint: platformFromHost(normalized.url.hostname, normalized.platform),
    ...(hintedTitle === undefined ? {} : { hintedTitle })
  };
}
