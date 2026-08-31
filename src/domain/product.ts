export type ProductPlatform = 'taobao' | 'jd' | 'generic';

export type ExtractionConfidence = 'high' | 'medium' | 'low';

export type ImageLoadStatus = 'idle' | 'loaded' | 'failed';

export interface ProductImage {
  id: string;
  url: string;
  source: 'json-ld' | 'open-graph' | 'meta' | 'dom' | 'user';
  selected: boolean;
  loadStatus: ImageLoadStatus;
}

export interface SourceProductFacts {
  title: string;
  description: string;
  price: number | null;
  originalPrice?: number;
  currency: string;
}

export interface ProductDraft {
  id: string;
  platform: ProductPlatform;
  canonicalUrl: string;
  source: SourceProductFacts;
  title: string;
  description: string;
  price: number | null;
  originalPrice?: number;
  currency: string;
  images: ProductImage[];
  warnings: string[];
  confidence: ExtractionConfidence;
  shippingMethod: string;
  categoryNote: string;
  updatedAt: string;
}

export interface ParsedProduct {
  platform: ProductPlatform;
  canonicalUrl: string;
  title: string;
  description: string;
  price: number | null;
  originalPrice?: number;
  currency: string;
  images: ProductImage[];
  warnings: string[];
  confidence: ExtractionConfidence;
}
