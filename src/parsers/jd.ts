import type { ParseCandidate } from './generic';
import { parsePrice } from './generic';

function textFrom(document: Document, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const value = document.querySelector<HTMLElement>(selector)?.innerText.trim();
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

export function parseJdDom(document: Document): ParseCandidate | null {
  const title = textFrom(document, ['.sku-name', 'h1']);
  const priceText = textFrom(document, ['.price.J-p-1', '[class*="price"]']);
  const price = parsePrice(priceText);
  if (title === undefined && price === undefined) {
    return null;
  }
  return {
    source: 'dom',
    platform: 'jd',
    ...(title === undefined ? {} : { title }),
    ...(price === undefined ? {} : { price }),
    images: []
  };
}
