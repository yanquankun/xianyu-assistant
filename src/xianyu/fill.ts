import type { ProductImage } from '../domain/product';
import { fillFileInput, fillTextControl, findFileInput, findTextControl } from './dom';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface TransferableImage {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ImageDownloadFailure {
  id: string;
  url: string;
  message: string;
}

export interface ImageDownloadResult {
  files: TransferableImage[];
  failures: ImageDownloadFailure[];
}

export interface XianyuFillPayload {
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  shippingMethod: string;
  categoryNote: string;
  images: TransferableImage[];
}

export type FillField = 'title' | 'price' | 'description' | 'images';

export interface SkippedField {
  field: FillField;
  reason: string;
}

export interface FillResult {
  filled: FillField[];
  skipped: SkippedField[];
  warnings: string[];
}

export type ImageFetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function downloadImage(
  fetchImpl: ImageFetchLike,
  image: ProductImage
): Promise<TransferableImage> {
  let response: Response;
  try {
    response = await fetchImpl(image.url, { method: 'GET', credentials: 'omit' });
  } catch {
    throw new Error('图片下载失败，请检查网络或来源权限');
  }
  if (!response.ok) {
    throw new Error(`图片下载返回 HTTP ${String(response.status)}`);
  }
  const mimeType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`图片响应类型不受支持：${mimeType || '未知类型'}`);
  }
  const declaredSize = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('图片超过 10 MB 上限');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('图片超过 10 MB 上限');
  }
  return {
    id: image.id,
    name: `${image.id}.${extensionForMime(mimeType)}`,
    mimeType,
    dataBase64: bytesToBase64(bytes)
  };
}

export async function downloadSelectedImages(
  fetchImpl: ImageFetchLike,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult> {
  const files: TransferableImage[] = [];
  const failures: ImageDownloadFailure[] = [];
  for (const image of images.filter((candidate) => candidate.selected)) {
    try {
      files.push(await downloadImage(fetchImpl, image));
    } catch (error) {
      failures.push({
        id: image.id,
        url: image.url,
        message: error instanceof Error ? error.message : '图片处理失败'
      });
    }
  }
  return { files, failures };
}

function fillTextField(
  document: Document,
  field: Exclude<FillField, 'images'>,
  selectors: readonly string[],
  label: string,
  value: string,
  result: FillResult
): void {
  const control = findTextControl(document, selectors, label);
  if (control === null) {
    result.skipped.push({ field, reason: `未找到${label}字段` });
    return;
  }
  try {
    fillTextControl(control, value);
    result.filled.push(field);
  } catch (error) {
    result.skipped.push({
      field,
      reason: error instanceof Error ? error.message : `${label}填写失败`
    });
  }
}

function createFiles(images: readonly TransferableImage[]): File[] {
  return images.map((image) => {
    const bytes = base64ToBytes(image.dataBase64);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new File([buffer], image.name, { type: image.mimeType });
  });
}

export async function fillXianyuDraft(
  document: Document,
  payload: XianyuFillPayload
): Promise<FillResult> {
  const result: FillResult = { filled: [], skipped: [], warnings: [] };
  fillTextField(
    document,
    'title',
    ['input[name="title"]', 'input[placeholder*="标题"]'],
    '标题',
    payload.title,
    result
  );
  fillTextField(
    document,
    'price',
    ['input[name="price"]', 'input[type="number"]', 'input[placeholder*="价格"]'],
    '价格',
    String(payload.price),
    result
  );
  fillTextField(
    document,
    'description',
    ['textarea[name="description"]', 'textarea[placeholder*="描述"]', '[contenteditable="true"]'],
    '描述',
    payload.description,
    result
  );

  const input = findFileInput(document);
  if (input === null) {
    result.skipped.push({ field: 'images', reason: '未找到图片上传字段' });
  } else if (payload.images.length === 0) {
    result.skipped.push({ field: 'images', reason: '没有可上传图片' });
  } else {
    try {
      fillFileInput(input, createFiles(payload.images));
      result.filled.push('images');
    } catch (error) {
      result.skipped.push({
        field: 'images',
        reason: error instanceof Error ? error.message : '图片填写失败'
      });
    }
  }
  await Promise.resolve();
  return result;
}
