import {
  getRemoteImageUrl,
  SHIPPING_METHODS,
  type ProductImage,
  type ShippingMethod
} from '../domain/product';
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
import { MAX_MEDIA_COUNT } from '../media/validation';
import { isXianyuVideoUploadEnabled } from './features';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
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

export function formatImageDownloadFailureWarning(
  failure: ImageDownloadFailure,
  index: number
): string {
  return `图片 ${String(index + 1)}：${failure.message}`;
}

export interface XianyuFillPayload {
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  shippingMethod: ShippingMethod;
  shippingFee?: number;
  supportsPickup: boolean;
  categoryNote: string;
  images: TransferableImage[];
  videoTransfers?: MediaTransferDescriptor[];
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
      'shippingFee',
      'supportsPickup',
      'categoryNote',
      'images',
      'videoTransfers'
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
    !SHIPPING_METHODS.some((method) => method === value.shippingMethod) ||
    (value.shippingMethod === '一口价'
      ? typeof value.shippingFee !== 'number' ||
        !Number.isFinite(value.shippingFee) ||
        value.shippingFee <= 0
      : value.shippingFee !== undefined) ||
    typeof value.supportsPickup !== 'boolean' ||
    !isBoundedText(value.categoryNote, 1_000) ||
    !Array.isArray(value.images) ||
    value.images.length === 0 ||
    value.images.length > MAX_MEDIA_COUNT ||
    !value.images.every(isTransferableImage) ||
    (value.videoTransfers !== undefined &&
      (!Array.isArray(value.videoTransfers) ||
        value.videoTransfers.length > MAX_MEDIA_COUNT ||
        !value.videoTransfers.every(isMediaTransferDescriptor))) ||
    value.images.length + (value.videoTransfers?.length ?? 0) > MAX_MEDIA_COUNT
  ) {
    return false;
  }
  const totalBase64Length = value.images.reduce(
    (total, image) => total + image.dataBase64.length,
    0
  );
  return totalBase64Length <= Math.ceil((MAX_TOTAL_IMAGE_BYTES * 4) / 3) + 4;
}

export type FillField =
  | 'title'
  | 'price'
  | 'originalPrice'
  | 'description'
  | 'shippingMethod'
  | 'shippingFee'
  | 'supportsPickup'
  | 'images'
  | 'video';

export interface SkippedField {
  field: FillField;
  reason: string;
}

export interface FillResult {
  filled: FillField[];
  skipped: SkippedField[];
  warnings: string[];
}

const FILL_FIELDS: readonly FillField[] = [
  'title',
  'price',
  'originalPrice',
  'description',
  'shippingMethod',
  'shippingFee',
  'supportsPickup',
  'images',
  'video'
];

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

export async function downloadImages(
  fetchImpl: ImageFetchLike,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult> {
  return prepareImages(fetchImpl, { get: () => Promise.resolve(null) }, images);
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

export async function prepareImages(
  fetchImpl: ImageFetchLike,
  mediaStore: Pick<MediaStore, 'get'>,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult> {
  const files: TransferableImage[] = [];
  const failures: ImageDownloadFailure[] = [];
  const allowedImages = images.slice(0, MAX_MEDIA_COUNT);
  const ready = allowedImages.filter((candidate) => candidate.loadStatus === 'loaded');
  for (const image of allowedImages.filter((candidate) => candidate.loadStatus !== 'loaded')) {
    const remoteUrl = getRemoteImageUrl(image);
    failures.push(
      remoteUrl === null
        ? { id: image.id, message: '图片尚未成功加载' }
        : { id: image.id, url: remoteUrl, message: '图片尚未成功加载' }
    );
  }
  for (const image of images.slice(MAX_MEDIA_COUNT)) {
    const remoteUrl = getRemoteImageUrl(image);
    failures.push(
      remoteUrl === null
        ? { id: image.id, message: `扩展每次最多处理 ${String(MAX_MEDIA_COUNT)} 个媒体` }
        : {
            id: image.id,
            url: remoteUrl,
            message: `扩展每次最多处理 ${String(MAX_MEDIA_COUNT)} 个媒体`
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
  field: FillField,
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

function selectShippingMethod(
  document: Document,
  shippingMethod: ShippingMethod,
  result: FillResult
): void {
  const label = Array.from(document.querySelectorAll<HTMLLabelElement>('label')).find(
    (candidate) => candidate.innerText.trim() === shippingMethod
  );
  const input = label?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
  if (input === null) {
    result.skipped.push({ field: 'shippingMethod', reason: '未找到发货方式字段' });
    return;
  }
  input.click();
  result.filled.push('shippingMethod');
}

function fillPickupSwitch(document: Document, supportsPickup: boolean, result: FillResult): void {
  const switchControl = Array.from(document.querySelectorAll<HTMLElement>('[role="switch"]')).find(
    (candidate) => candidate.parentElement?.innerText.includes('支持自提')
  );
  if (switchControl === undefined) {
    result.skipped.push({ field: 'supportsPickup', reason: '未找到支持自提开关' });
    return;
  }
  const checked = switchControl.getAttribute('aria-checked') === 'true';
  if (checked !== supportsPickup) {
    switchControl.click();
  }
  result.filled.push('supportsPickup');
}

function createFiles(images: readonly TransferableImage[]): File[] {
  return images.map((image) => {
    const bytes = base64ToBytes(image.dataBase64);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new File([buffer], image.name, { type: image.mimeType });
  });
}

const managedImageSourcesByDocument = new WeakMap<Document, Map<string, string>>();

function imageListFor(input: HTMLInputElement): HTMLElement | null {
  const root = input.closest<HTMLElement>('.ant-form-item, form') ?? input.ownerDocument.body;
  return root.querySelector<HTMLElement>('[class*="imgList--"]');
}

function imagePreviewItems(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[class*="preview-container--"]'));
}

function normalizedRemoteImageSource(source: string): string | null {
  const value = source.trim();
  if (value.startsWith('//')) {
    return `https:${value}`;
  }
  return value.startsWith('https://') || value.startsWith('http://') ? value : null;
}

function imagePreviewSource(item: HTMLElement): string | null {
  for (const image of item.querySelectorAll<HTMLImageElement>('img')) {
    if (image.style.objectFit !== 'contain' || image.style.display === 'none') {
      continue;
    }
    const source = normalizedRemoteImageSource(image.getAttribute('src') ?? '');
    if (source !== null) {
      return source;
    }
  }
  return null;
}

function managedImageSources(document: Document): Map<string, string> {
  const existing = managedImageSourcesByDocument.get(document);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, string>();
  managedImageSourcesByDocument.set(document, created);
  return created;
}

async function waitForImageCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('闲鱼图片列表同步超时，请检查图片上传状态后重试');
}

function normalizedText(element: Element): string {
  return element.textContent.replace(/\s+/g, '');
}

function imageDeletionConfirmButton(remove: HTMLElement): HTMLButtonElement | null {
  if (!remove.classList.contains('ant-popover-open')) {
    return null;
  }
  for (const popconfirm of remove.ownerDocument.querySelectorAll<HTMLElement>('.ant-popconfirm')) {
    const title = popconfirm.querySelector<HTMLElement>('.ant-popconfirm-title');
    if (title === null || normalizedText(title) !== '确定要删除这张图片吗？') {
      continue;
    }
    const confirm = Array.from(
      popconfirm.querySelectorAll<HTMLButtonElement>('.ant-popconfirm-buttons button')
    ).find((button) => normalizedText(button) === '确认');
    if (confirm !== undefined) {
      return confirm;
    }
  }
  return null;
}

async function confirmImageDeletionIfRequested(
  remove: HTMLElement,
  list: HTMLElement,
  previousCount: number
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (imagePreviewItems(list).length < previousCount) {
      return;
    }
    const confirm = imageDeletionConfirmButton(remove);
    if (confirm !== null) {
      confirm.click();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('未找到闲鱼图片删除确认按钮，请检查页面后重试');
}

async function syncImageFileInput(
  input: HTMLInputElement,
  images: readonly TransferableImage[]
): Promise<void> {
  const list = imageListFor(input);
  if (list === null) {
    fillFileInput(input, createFiles(images));
    return;
  }

  const sourcesByImageId = managedImageSources(input.ownerDocument);
  const desiredIds = new Set(images.map((image) => image.id));
  for (const [imageId, source] of sourcesByImageId) {
    if (desiredIds.has(imageId)) {
      continue;
    }
    const item = imagePreviewItems(list).find(
      (candidate) => imagePreviewSource(candidate) === source
    );
    sourcesByImageId.delete(imageId);
    if (item === undefined) {
      continue;
    }
    const previousCount = imagePreviewItems(list).length;
    const remove = item.querySelector<HTMLElement>('[class*="delete-btn--"]');
    if (remove === null) {
      throw new Error('未找到闲鱼图片删除控件，已停止同步以避免重复图片');
    }
    remove.click();
    await confirmImageDeletionIfRequested(remove, list, previousCount);
    await waitForImageCondition(() => imagePreviewItems(list).length < previousCount);
  }

  const currentSources = new Set(
    imagePreviewItems(list).flatMap((item) => {
      const source = imagePreviewSource(item);
      return source === null ? [] : [source];
    })
  );
  const existingIds = new Set<string>();
  for (const [imageId, source] of sourcesByImageId) {
    if (currentSources.has(source)) {
      existingIds.add(imageId);
    } else {
      sourcesByImageId.delete(imageId);
    }
  }
  const missingImages = images.filter((image) => !existingIds.has(image.id));
  if (missingImages.length === 0) {
    return;
  }

  const previousCount = imagePreviewItems(list).length;
  fillFileInput(input, createFiles(missingImages));
  await waitForImageCondition(() => {
    const uploadedItems = imagePreviewItems(list).slice(
      previousCount,
      previousCount + missingImages.length
    );
    return (
      uploadedItems.length === missingImages.length &&
      uploadedItems.every((item) => imagePreviewSource(item) !== null)
    );
  });
  const uploadedItems = imagePreviewItems(list).slice(
    previousCount,
    previousCount + missingImages.length
  );
  uploadedItems.forEach((item, index) => {
    const image = missingImages[index];
    const source = imagePreviewSource(item);
    if (image !== undefined && source !== null) {
      sourcesByImageId.set(image.id, source);
    }
  });
}

export async function fillXianyuDraft(
  document: Document,
  payload: XianyuFillPayload,
  videoFiles: readonly File[] = []
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
  if (payload.originalPrice !== undefined) {
    fillTextField(
      document,
      'originalPrice',
      ['input[name="originalPrice"]'],
      '原价',
      String(payload.originalPrice),
      result
    );
  }
  fillTextField(
    document,
    'price',
    ['input[name="price"]', 'input[type="number"]', 'input[placeholder*="价格"]'],
    '价格',
    String(payload.price),
    result
  );

  selectShippingMethod(document, payload.shippingMethod, result);
  await Promise.resolve();
  if (payload.shippingMethod === '一口价' && payload.shippingFee !== undefined) {
    fillTextField(
      document,
      'shippingFee',
      ['input[name="shippingFee"]'],
      '邮费',
      String(payload.shippingFee),
      result
    );
  }
  fillPickupSwitch(document, payload.supportsPickup, result);
  fillTextField(
    document,
    'description',
    ['textarea[name="description"]', 'textarea[placeholder*="描述"]', '[contenteditable="true"]'],
    '描述',
    payload.description,
    result
  );

  const input = payload.images.length === 0 ? null : findImageFileInput(document);
  if (payload.images.length > 0 && input === null) {
    result.skipped.push({ field: 'images', reason: '未找到图片上传字段' });
  } else if (input !== null) {
    try {
      await syncImageFileInput(input, payload.images);
      result.filled.push('images');
    } catch (error) {
      result.skipped.push({
        field: 'images',
        reason: error instanceof Error ? error.message : '图片填写失败'
      });
    }
  }

  if (isXianyuVideoUploadEnabled() && videoFiles.length > 0) {
    const videoInput = findVideoFileInput(document);
    if (videoInput === null) {
      result.skipped.push({
        field: 'video',
        reason: '未找到可靠的视频上传字段，请在闲鱼页面手动上传视频'
      });
    } else {
      try {
        fillFileInput(videoInput, videoFiles);
        result.filled.push('video');
      } catch (error) {
        result.skipped.push({
          field: 'video',
          reason: error instanceof Error ? error.message : '视频填写失败'
        });
      }
    }
  } else if (isXianyuVideoUploadEnabled() && (payload.videoTransfers?.length ?? 0) > 0) {
    result.skipped.push({ field: 'video', reason: '视频传输失败，请在闲鱼页面手动上传视频' });
  }
  await Promise.resolve();
  return result;
}
