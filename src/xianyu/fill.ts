import { getRemoteImageUrl, type ProductImage } from '../domain/product';
import type { AppError, OperationResult } from '../domain/errors';
import type { MediaStore, StoredMediaAsset } from '../storage/media-store';
import {
  fillFileInput,
  fillTextControl,
  findImageFileInput,
  findTextControl,
  findVideoFileInput
} from './dom';
import { isMediaTransferDescriptor, type MediaTransferDescriptor } from './media-transfer';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_COUNT = 9;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_REQUEST_TIMEOUT_MS = 20_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

class ImageDownloadError extends Error {}

export interface TransferableImage {
  id: string;
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ImageDownloadFailure {
  id: string;
  url?: string;
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
  videoTransfer?: MediaTransferDescriptor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function isTransferableImage(value: unknown): value is TransferableImage {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'name', 'mimeType', 'dataBase64']) &&
    isBoundedText(value.id, 200) &&
    value.id.length > 0 &&
    isBoundedText(value.name, 300) &&
    value.name.length > 0 &&
    typeof value.mimeType === 'string' &&
    ALLOWED_IMAGE_TYPES.has(value.mimeType) &&
    isBoundedText(value.dataBase64, Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
  );
}

export function isXianyuFillPayload(value: unknown): value is XianyuFillPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'title',
      'description',
      'price',
      'originalPrice',
      'shippingMethod',
      'categoryNote',
      'images',
      'videoTransfer'
    ]) ||
    !isBoundedText(value.title, 500) ||
    !isBoundedText(value.description, 20_000) ||
    typeof value.price !== 'number' ||
    !Number.isFinite(value.price) ||
    value.price <= 0 ||
    (value.originalPrice !== undefined &&
      (typeof value.originalPrice !== 'number' ||
        !Number.isFinite(value.originalPrice) ||
        value.originalPrice <= 0)) ||
    !isBoundedText(value.shippingMethod, 100) ||
    !isBoundedText(value.categoryNote, 1_000) ||
    !Array.isArray(value.images) ||
    value.images.length > MAX_IMAGE_COUNT ||
    !value.images.every(isTransferableImage) ||
    (value.videoTransfer !== undefined && !isMediaTransferDescriptor(value.videoTransfer))
  ) {
    return false;
  }
  const totalBase64Length = value.images.reduce(
    (total, image) => total + image.dataBase64.length,
    0
  );
  return totalBase64Length <= Math.ceil((MAX_TOTAL_IMAGE_BYTES * 4) / 3) + 4;
}

export type FillField = 'title' | 'price' | 'description' | 'images' | 'video';

export interface SkippedField {
  field: FillField;
  reason: string;
}

export interface FillResult {
  filled: FillField[];
  skipped: SkippedField[];
  warnings: string[];
}

const FILL_FIELDS: readonly FillField[] = ['title', 'price', 'description', 'images', 'video'];

function isFillField(value: unknown): value is FillField {
  return typeof value === 'string' && FILL_FIELDS.includes(value as FillField);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((entry) => typeof entry === 'string' && entry.length <= 2_000)
  );
}

function isFillResultValue(value: unknown): value is FillResult {
  return (
    isRecord(value) &&
    Array.isArray(value.filled) &&
    value.filled.length <= FILL_FIELDS.length &&
    value.filled.every(isFillField) &&
    Array.isArray(value.skipped) &&
    value.skipped.length <= FILL_FIELDS.length &&
    value.skipped.every(
      (entry) =>
        isRecord(entry) &&
        isFillField(entry.field) &&
        isBoundedText(entry.reason, 2_000) &&
        entry.reason.length > 0
    ) &&
    isStringList(value.warnings)
  );
}

function isAppError(value: unknown): value is AppError {
  return (
    isRecord(value) &&
    isBoundedText(value.code, 100) &&
    value.code.length > 0 &&
    isBoundedText(value.message, 2_000) &&
    value.message.length > 0 &&
    isBoundedText(value.recovery, 2_000) &&
    typeof value.draftPreserved === 'boolean'
  );
}

export function parseXianyuFillResult(value: unknown): OperationResult<FillResult> | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return null;
  }
  if (value.ok) {
    return isFillResultValue(value.value) ? { ok: true, value: value.value } : null;
  }
  return isAppError(value.error) ? { ok: false, error: value.error } : null;
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

async function readBoundedImageBytes(response: Response): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_IMAGE_BYTES) {
      await reader.cancel('图片超过 10 MB 上限');
      throw new ImageDownloadError('图片超过 10 MB 上限');
    }
    chunks.push(value);
  }
}

async function downloadImage(
  fetchImpl: ImageFetchLike,
  image: ProductImage,
  remoteUrl: string
): Promise<{ file: TransferableImage; byteLength: number }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = (async () => {
      const response = await fetchImpl(remoteUrl, {
        method: 'GET',
        credentials: 'omit',
        signal: controller.signal
      });
      if (!response.ok) {
        throw new ImageDownloadError(`图片下载返回 HTTP ${String(response.status)}`);
      }
      const mimeType =
        (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new ImageDownloadError(`图片响应类型不受支持：${mimeType || '未知类型'}`);
      }
      const declaredSize = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
        throw new ImageDownloadError('图片超过 10 MB 上限');
      }
      const bytes = await readBoundedImageBytes(response);
      return {
        file: {
          id: image.id,
          name: `${image.id}.${extensionForMime(mimeType)}`,
          mimeType,
          dataBase64: bytesToBase64(bytes)
        },
        byteLength: bytes.byteLength
      };
    })();
    const timeoutRequest = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ImageDownloadError('图片下载超时，请稍后重试'));
      }, IMAGE_REQUEST_TIMEOUT_MS);
    });
    return await Promise.race([request, timeoutRequest]);
  } catch (error) {
    if (error instanceof ImageDownloadError) {
      throw error;
    }
    throw new Error('图片下载失败，请检查网络或来源权限', { cause: error });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function downloadSelectedImages(
  fetchImpl: ImageFetchLike,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult> {
  return prepareSelectedImages(fetchImpl, { get: () => Promise.resolve(null) }, images);
}

function localImageFailure(image: ProductImage, message: string): ImageDownloadFailure {
  return { id: image.id, message };
}

function validateLocalImageAsset(
  image: ProductImage,
  asset: StoredMediaAsset | null
): StoredMediaAsset {
  if (image.location.kind !== 'local' || asset?.kind !== 'image') {
    throw new ImageDownloadError('本地图片不存在或已被删除');
  }
  if (!ALLOWED_IMAGE_TYPES.has(asset.mimeType) || asset.blob.type !== asset.mimeType) {
    throw new ImageDownloadError('图片类型不受支持');
  }
  if (asset.byteLength > MAX_IMAGE_BYTES || asset.blob.size > MAX_IMAGE_BYTES) {
    throw new ImageDownloadError('图片超过 10 MB 上限');
  }
  if (
    asset.byteLength <= 0 ||
    asset.blob.size !== asset.byteLength ||
    asset.assetId !== image.location.assetId ||
    asset.fileName !== image.location.fileName ||
    asset.mimeType !== image.location.mimeType ||
    asset.byteLength !== image.location.byteLength
  ) {
    throw new ImageDownloadError('本地图片数据无效');
  }
  return asset;
}

async function readLocalImage(
  mediaStore: Pick<MediaStore, 'get'>,
  image: ProductImage
): Promise<{ file: TransferableImage; byteLength: number }> {
  if (image.location.kind !== 'local') {
    throw new ImageDownloadError('本地图片引用无效');
  }
  const asset = validateLocalImageAsset(image, await mediaStore.get(image.location.assetId));
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (bytes.byteLength !== asset.byteLength) {
    throw new ImageDownloadError('本地图片数据无效');
  }
  return {
    file: {
      id: image.id,
      name: asset.fileName,
      mimeType: asset.mimeType,
      dataBase64: bytesToBase64(bytes)
    },
    byteLength: bytes.byteLength
  };
}

export async function prepareSelectedImages(
  fetchImpl: ImageFetchLike,
  mediaStore: Pick<MediaStore, 'get'>,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult> {
  const files: TransferableImage[] = [];
  const failures: ImageDownloadFailure[] = [];
  const selected = images.filter((candidate) => candidate.selected);
  const allowedSelected = selected.slice(0, MAX_IMAGE_COUNT);
  const ready = allowedSelected.filter((candidate) => candidate.loadStatus === 'loaded');
  for (const image of allowedSelected.filter((candidate) => candidate.loadStatus !== 'loaded')) {
    const remoteUrl = getRemoteImageUrl(image);
    failures.push(
      remoteUrl === null
        ? { id: image.id, message: '图片尚未成功加载' }
        : { id: image.id, url: remoteUrl, message: '图片尚未成功加载' }
    );
  }
  for (const image of selected.slice(MAX_IMAGE_COUNT)) {
    const remoteUrl = getRemoteImageUrl(image);
    failures.push(
      remoteUrl === null
        ? { id: image.id, message: `扩展每次最多处理 ${String(MAX_IMAGE_COUNT)} 张图片` }
        : {
            id: image.id,
            url: remoteUrl,
            message: `扩展每次最多处理 ${String(MAX_IMAGE_COUNT)} 张图片`
          }
    );
  }
  let totalBytes = 0;
  for (const image of ready) {
    const remoteUrl = getRemoteImageUrl(image);
    try {
      const downloaded =
        remoteUrl === null
          ? await readLocalImage(mediaStore, image)
          : await downloadImage(fetchImpl, image, remoteUrl);
      if (totalBytes + downloaded.byteLength > MAX_TOTAL_IMAGE_BYTES) {
        failures.push(
          remoteUrl === null
            ? localImageFailure(image, '图片总量超过 20 MB 上限')
            : { id: image.id, url: remoteUrl, message: '图片总量超过 20 MB 上限' }
        );
        continue;
      }
      totalBytes += downloaded.byteLength;
      files.push(downloaded.file);
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片处理失败';
      failures.push(
        remoteUrl === null
          ? localImageFailure(image, message)
          : { id: image.id, url: remoteUrl, message }
      );
    }
  }
  return { files, failures };
}

function fillTextField(
  document: Document,
  field: 'title' | 'price' | 'description',
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
  payload: XianyuFillPayload,
  videoFile?: File
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

  const input = findImageFileInput(document);
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

  if (videoFile !== undefined) {
    const videoInput = findVideoFileInput(document);
    if (videoInput === null) {
      result.skipped.push({
        field: 'video',
        reason: '未找到可靠的视频上传字段，请在闲鱼页面手动上传视频'
      });
    } else {
      try {
        fillFileInput(videoInput, [videoFile]);
        result.filled.push('video');
      } catch (error) {
        result.skipped.push({
          field: 'video',
          reason: error instanceof Error ? error.message : '视频填写失败'
        });
      }
    }
  } else if (payload.videoTransfer !== undefined) {
    result.skipped.push({ field: 'video', reason: '视频传输失败，请在闲鱼页面手动上传视频' });
  }
  await Promise.resolve();
  return result;
}
