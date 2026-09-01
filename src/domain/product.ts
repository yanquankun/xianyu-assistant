export type ProductPlatform = 'taobao' | 'tmall' | 'jd' | 'generic';

export type ExtractionConfidence = 'high' | 'medium' | 'low';

export type ImageLoadStatus = 'idle' | 'loaded' | 'failed';

export type RemoteImageExtractionSource =
  | 'json-ld'
  | 'open-graph'
  | 'meta'
  | 'semantic-dom'
  | 'embedded-state'
  | 'platform-gallery';

export type ProductImageLocation =
  | {
      kind: 'remote';
      url: string;
      extractedBy: RemoteImageExtractionSource;
    }
  | {
      kind: 'local';
      assetId: string;
      fileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      byteLength: number;
    };

export interface ProductImage {
  id: string;
  location: ProductImageLocation;
  loadStatus: ImageLoadStatus;
}

export interface ProductVideo {
  id: string;
  assetId: string;
  fileName: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  byteLength: number;
}

export interface StoredDraftParseResult {
  draft: ProductDraft;
  migrated: boolean;
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
  submittedUrl?: string;
  canonicalUrl: string;
  source: SourceProductFacts;
  title: string;
  description: string;
  price: number | null;
  originalPrice?: number;
  currency: string;
  images: ProductImage[];
  videos: ProductVideo[];
  warnings: string[];
  confidence: ExtractionConfidence;
  shippingMethod: string;
  categoryNote: string;
  updatedAt: string;
}

export interface ParsedProduct {
  platform: ProductPlatform;
  submittedUrl?: string;
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

export interface ProductExtractionError {
  message: string;
  code?: string;
}

export type ProductExtractionResponse =
  { ok: true; product: ParsedProduct } | { ok: false; error: ProductExtractionError };

export function getRemoteImageUrl(image: ProductImage): string | null {
  return image.location.kind === 'remote' ? image.location.url : null;
}

export function getLocalAssetIds(draft: ProductDraft): string[] {
  const imageIds = draft.images.flatMap((image) =>
    image.location.kind === 'local' ? [image.location.assetId] : []
  );
  return [...imageIds, ...draft.videos.map((video) => video.assetId)];
}
