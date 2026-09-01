import type { ExtractionConfidence, ProductPlatform } from '../domain/product';

export type EvidenceSource =
  | 'json-ld'
  | 'open-graph'
  | 'meta'
  | 'semantic-dom'
  | 'embedded-state'
  | 'platform-gallery';

export interface EvidenceContext {
  platform: ProductPlatform;
  pageUrl: string;
  productId?: string;
  skuId?: string;
}

export interface FieldEvidence<T> {
  value: T;
  source: EvidenceSource;
  confidence: ExtractionConfidence;
  productId?: string;
  skuId?: string;
  label?: string;
}

export type PriceKind = 'sale' | 'original' | 'conditional' | 'unknown';

export interface PriceEvidence extends FieldEvidence<number> {
  currency: 'CNY';
  kind: PriceKind;
}

export interface ImageEvidence extends FieldEvidence<string> {
  highResolutionUrl?: string;
  position: number;
}

export interface ProductEvidenceSet {
  titles: FieldEvidence<string>[];
  descriptions: FieldEvidence<string>[];
  prices: PriceEvidence[];
  images: ImageEvidence[];
  canonicalUrls: FieldEvidence<string>[];
  warnings: string[];
}

export function createEvidenceSet(): ProductEvidenceSet {
  return {
    titles: [],
    descriptions: [],
    prices: [],
    images: [],
    canonicalUrls: [],
    warnings: []
  };
}

export function mergeEvidenceSets(...sets: readonly ProductEvidenceSet[]): ProductEvidenceSet {
  return {
    titles: sets.flatMap((set) => set.titles),
    descriptions: sets.flatMap((set) => set.descriptions),
    prices: sets.flatMap((set) => set.prices),
    images: sets.flatMap((set) => set.images),
    canonicalUrls: sets.flatMap((set) => set.canonicalUrls),
    warnings: sets.flatMap((set) => set.warnings)
  };
}
