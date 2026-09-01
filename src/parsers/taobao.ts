import { collectAliEvidence } from './ali';
import type { EvidenceContext, ProductEvidenceSet } from './evidence';

const TAOBAO_SELECTORS = {
  title: ['[data-title="product-title"]'],
  priceRegions: ['[data-price-region="product"]'],
  galleryRegions: ['[data-product-gallery="taobao"]']
} as const;

export function collectTaobaoEvidence(
  document: Document,
  context: EvidenceContext
): ProductEvidenceSet {
  return collectAliEvidence(document, context, TAOBAO_SELECTORS);
}
