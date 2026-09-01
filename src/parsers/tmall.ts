import { collectAliEvidence } from './ali';
import type { EvidenceContext, ProductEvidenceSet } from './evidence';

const TMALL_SELECTORS = {
  title: ['#J_DetailMeta h1[data-spm="1000983"]'],
  priceRegions: ['#J_PromoPrice'],
  galleryRegions: ['#J_UlThumb']
} as const;

export function collectTmallEvidence(
  document: Document,
  context: EvidenceContext
): ProductEvidenceSet {
  return collectAliEvidence(document, context, TMALL_SELECTORS);
}
