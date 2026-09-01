import { createEvidenceSet, type EvidenceContext, type ProductEvidenceSet } from './evidence';
import { parsePrice } from './generic';

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

export function collectJdEvidence(
  document: Document,
  context: EvidenceContext
): Promise<ProductEvidenceSet> {
  const evidence = createEvidenceSet();
  const binding = {
    ...(context.productId === undefined ? {} : { productId: context.productId }),
    ...(context.skuId === undefined ? {} : { skuId: context.skuId })
  };
  const title = textFrom(document, ['.sku-name', 'h1']);
  if (title !== undefined) {
    evidence.titles.push({
      value: title,
      source: 'semantic-dom',
      confidence: 'medium',
      ...binding
    });
  }
  const price = parsePrice(textFrom(document, ['.price.J-p-1', '[class*="price"]']));
  if (price !== undefined) {
    evidence.prices.push({
      value: price,
      currency: 'CNY',
      kind: 'sale',
      source: 'semantic-dom',
      confidence: 'medium',
      ...binding
    });
  }
  return Promise.resolve(evidence);
}
