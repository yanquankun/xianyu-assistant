import { MAX_VIDEO_BYTES } from '../media/validation';
import type { MediaStore, StoredMediaAsset } from '../storage/media-store';

export const MEDIA_TRANSFER_PORT_NAME = 'xianyu-media-transfer';
export const MEDIA_TRANSFER_CHUNK_BYTES = 512 * 1024;
export const MEDIA_TRANSFER_REQUEST_TIMEOUT_MS = 15_000;

const MEDIA_TRANSFER_TTL_MS = 60_000;
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime']);
const MAX_BASE64_CHUNK_LENGTH = Math.ceil((MEDIA_TRANSFER_CHUNK_BYTES * 4) / 3) + 4;

export interface MediaTransferDescriptor {
  sessionId: string;
  fileName: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  byteLength: number;
  chunkBytes: number;
}

export interface MediaTransferChunk {
  sessionId: string;
  offset: number;
  dataBase64: string;
  done: boolean;
}

export type MediaTransferClientRequest =
  { type: 'READ'; sessionId: string; offset: number } | { type: 'CLOSE'; sessionId: string };

export type MediaTransferServerResponse =
  | { type: 'CHUNK'; chunk: MediaTransferChunk }
  | { type: 'ERROR'; sessionId: string; message: string };

interface MediaTransferSession {
  assetId: string;
  tabId: number;
  fileName: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  byteLength: number;
  nextOffset: number;
  expiresAt: number;
  reading: boolean;
  expiryTimer: ReturnType<typeof setTimeout>;
}

export interface ReceiveMediaFileOptions {
  timeoutMs?: number;
}

export interface MediaTransferRegistry {
  create(assetId: string, tabId: number): Promise<MediaTransferDescriptor>;
  read(sessionId: string, tabId: number, offset: number): Promise<MediaTransferChunk>;
  release(sessionId: string, tabId: number): Promise<void>;
  releaseForTab(tabId: number): void;
  releaseExpired(): void;
}

export interface MediaTransferSender {
  id?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
  url?: string | undefined;
}

interface ListenerCollection<TListener> {
  addListener(listener: TListener): void;
  removeListener(listener: TListener): void;
}

export interface MediaTransferClientPort {
  postMessage(message: MediaTransferClientRequest): void;
  disconnect(): void;
  onMessage: ListenerCollection<(message: unknown) => void>;
  onDisconnect: ListenerCollection<() => void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isNonEmptyBoundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isAllowedVideoType(value: unknown): value is 'video/mp4' | 'video/quicktime' {
  return typeof value === 'string' && ALLOWED_VIDEO_TYPES.has(value);
}

function isPositiveSafeInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0 && value <= maximum;
}

export function isMediaTransferDescriptor(value: unknown): value is MediaTransferDescriptor {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['sessionId', 'fileName', 'mimeType', 'byteLength', 'chunkBytes']) &&
    isNonEmptyBoundedText(value.sessionId, 200) &&
    isNonEmptyBoundedText(value.fileName, 300) &&
    isAllowedVideoType(value.mimeType) &&
    isPositiveSafeInteger(value.byteLength, MAX_VIDEO_BYTES) &&
    value.chunkBytes === MEDIA_TRANSFER_CHUNK_BYTES
  );
}

export function isMediaTransferClientRequest(value: unknown): value is MediaTransferClientRequest {
  if (!isRecord(value) || !isNonEmptyBoundedText(value.sessionId, 200)) {
    return false;
  }
  if (value.type === 'READ') {
    return (
      hasOnlyKeys(value, ['type', 'sessionId', 'offset']) &&
      typeof value.offset === 'number' &&
      Number.isSafeInteger(value.offset) &&
      value.offset >= 0
    );
  }
  return value.type === 'CLOSE' && hasOnlyKeys(value, ['type', 'sessionId']);
}

function isMediaTransferChunk(value: unknown): value is MediaTransferChunk {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['sessionId', 'offset', 'dataBase64', 'done']) &&
    isNonEmptyBoundedText(value.sessionId, 200) &&
    typeof value.offset === 'number' &&
    Number.isSafeInteger(value.offset) &&
    value.offset >= 0 &&
    typeof value.dataBase64 === 'string' &&
    value.dataBase64.length > 0 &&
    value.dataBase64.length <= MAX_BASE64_CHUNK_LENGTH &&
    typeof value.done === 'boolean'
  );
}

function parseMediaTransferServerResponse(value: unknown): MediaTransferServerResponse | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.type === 'CHUNK') {
    return hasOnlyKeys(value, ['type', 'chunk']) && isMediaTransferChunk(value.chunk)
      ? { type: 'CHUNK', chunk: value.chunk }
      : null;
  }
  if (value.type === 'ERROR') {
    return hasOnlyKeys(value, ['type', 'sessionId', 'message']) &&
      isNonEmptyBoundedText(value.sessionId, 200) &&
      isNonEmptyBoundedText(value.message, 2_000)
      ? { type: 'ERROR', sessionId: value.sessionId, message: value.message }
      : null;
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('媒体传输分块编码无效');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validateStoredVideo(asset: StoredMediaAsset | null): StoredMediaAsset & {
  mimeType: 'video/mp4' | 'video/quicktime';
} {
  if (asset?.kind !== 'video') {
    throw new Error('本地视频不存在或已被删除');
  }
  if (!isAllowedVideoType(asset.mimeType) || asset.blob.type !== asset.mimeType) {
    throw new Error('视频类型不受支持');
  }
  if (
    !isPositiveSafeInteger(asset.byteLength, MAX_VIDEO_BYTES) ||
    asset.blob.size !== asset.byteLength
  ) {
    if (asset.byteLength > MAX_VIDEO_BYTES || asset.blob.size > MAX_VIDEO_BYTES) {
      throw new Error('视频超过 100 MB 上限');
    }
    throw new Error('本地视频数据无效');
  }
  return asset as StoredMediaAsset & { mimeType: 'video/mp4' | 'video/quicktime' };
}

export function createMediaTransferRegistry(
  mediaStore: Pick<MediaStore, 'get'>,
  now: () => number = () => Date.now(),
  createId: () => string = () => crypto.randomUUID()
): MediaTransferRegistry {
  const sessions = new Map<string, MediaTransferSession>();

  function deleteSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session !== undefined) {
      clearTimeout(session.expiryTimer);
      sessions.delete(sessionId);
    }
  }

  function scheduleExpiry(sessionId: string, session: MediaTransferSession): void {
    clearTimeout(session.expiryTimer);
    session.expiryTimer = setTimeout(
      () => {
        const current = sessions.get(sessionId);
        if (current === undefined) {
          return;
        }
        if (now() >= current.expiresAt) {
          deleteSession(sessionId);
          return;
        }
        scheduleExpiry(sessionId, current);
      },
      Math.max(0, session.expiresAt - now())
    );
  }

  function activeSession(sessionId: string): MediaTransferSession {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      throw new Error('媒体传输会话不存在');
    }
    if (now() >= session.expiresAt) {
      deleteSession(sessionId);
      throw new Error('媒体传输会话已过期');
    }
    return session;
  }

  function requireTarget(session: MediaTransferSession, tabId: number): void {
    if (session.tabId !== tabId) {
      throw new Error('媒体传输目标不匹配');
    }
  }

  return {
    async create(assetId, tabId): Promise<MediaTransferDescriptor> {
      if (!isNonEmptyBoundedText(assetId, 200) || !Number.isSafeInteger(tabId) || tabId < 0) {
        throw new Error('媒体传输参数无效');
      }
      const asset = validateStoredVideo(await mediaStore.get(assetId));
      const sessionId = createId();
      if (!isNonEmptyBoundedText(sessionId, 200) || sessions.has(sessionId)) {
        throw new Error('无法创建媒体传输会话');
      }
      const session: MediaTransferSession = {
        assetId,
        tabId,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
        nextOffset: 0,
        expiresAt: now() + MEDIA_TRANSFER_TTL_MS,
        reading: false,
        expiryTimer: setTimeout(() => undefined, 0)
      };
      sessions.set(sessionId, session);
      scheduleExpiry(sessionId, session);
      return {
        sessionId,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
        chunkBytes: MEDIA_TRANSFER_CHUNK_BYTES
      };
    },

    async read(sessionId, tabId, offset): Promise<MediaTransferChunk> {
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new Error('媒体传输偏移无效');
      }
      const session = activeSession(sessionId);
      requireTarget(session, tabId);
      if (offset !== session.nextOffset) {
        throw new Error('媒体传输偏移不连续');
      }
      if (session.reading) {
        throw new Error('媒体传输分块请求尚未完成');
      }
      session.reading = true;
      try {
        const asset = validateStoredVideo(await mediaStore.get(session.assetId));
        if (
          asset.fileName !== session.fileName ||
          asset.mimeType !== session.mimeType ||
          asset.byteLength !== session.byteLength
        ) {
          deleteSession(sessionId);
          throw new Error('媒体传输资源已发生变化');
        }
        const end = Math.min(offset + MEDIA_TRANSFER_CHUNK_BYTES, session.byteLength);
        const bytes = new Uint8Array(await asset.blob.slice(offset, end).arrayBuffer());
        if (bytes.byteLength !== end - offset || bytes.byteLength > MEDIA_TRANSFER_CHUNK_BYTES) {
          deleteSession(sessionId);
          throw new Error('媒体传输分块大小无效');
        }
        const done = end === session.byteLength;
        const chunk: MediaTransferChunk = {
          sessionId,
          offset,
          dataBase64: bytesToBase64(bytes),
          done
        };
        if (done) {
          deleteSession(sessionId);
        } else {
          session.nextOffset = end;
          session.expiresAt = now() + MEDIA_TRANSFER_TTL_MS;
          scheduleExpiry(sessionId, session);
        }
        return chunk;
      } catch (error) {
        deleteSession(sessionId);
        throw error;
      } finally {
        const current = sessions.get(sessionId);
        if (current !== undefined) {
          current.reading = false;
        }
      }
    },

    release(sessionId, tabId): Promise<void> {
      const session = sessions.get(sessionId);
      if (session === undefined) {
        return Promise.resolve();
      }
      if (session.tabId !== tabId) {
        return Promise.reject(new Error('媒体传输目标不匹配'));
      }
      deleteSession(sessionId);
      return Promise.resolve();
    },

    releaseForTab(tabId): void {
      for (const [sessionId, session] of sessions) {
        if (session.tabId === tabId) {
          deleteSession(sessionId);
        }
      }
    },

    releaseExpired(): void {
      const currentTime = now();
      for (const [sessionId, session] of sessions) {
        if (currentTime >= session.expiresAt) {
          deleteSession(sessionId);
        }
      }
    }
  };
}

export function isTrustedMediaTransferSender(
  sender: MediaTransferSender,
  extensionId: string
): number | null {
  if (sender.id !== extensionId || sender.tab?.id === undefined || sender.url === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(sender.tab.id) || sender.tab.id < 0) {
    return null;
  }
  try {
    const url = new URL(sender.url);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.goofish.com'
      ? sender.tab.id
      : null;
  } catch {
    return null;
  }
}

function requestChunk(
  port: MediaTransferClientPort,
  sessionId: string,
  offset: number,
  timeoutMs: number
): Promise<MediaTransferChunk> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onMessage = (value: unknown) => {
      const response = parseMediaTransferServerResponse(value);
      if (response === null) {
        finish(() => reject(new Error('媒体传输响应格式无效')));
        return;
      }
      if (response.type === 'ERROR') {
        finish(() =>
          reject(
            new Error(
              response.sessionId === sessionId
                ? response.message
                : '媒体传输响应与请求不匹配'
            )
          )
        );
        return;
      }
      finish(() => resolve(response.chunk));
    };
    const onDisconnect = () => {
      finish(() => reject(new Error('媒体传输连接已关闭')));
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('媒体传输等待响应超时')));
    }, timeoutMs);
    try {
      port.postMessage({ type: 'READ', sessionId, offset });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('媒体传输请求失败')));
    }
  });
}

export async function receiveMediaFile(
  descriptor: MediaTransferDescriptor,
  connect: () => MediaTransferClientPort,
  options: ReceiveMediaFileOptions = {}
): Promise<File> {
  if (!isMediaTransferDescriptor(descriptor)) {
    throw new Error('媒体传输描述无效');
  }
  const timeoutMs = options.timeoutMs ?? MEDIA_TRANSFER_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('媒体传输超时配置无效');
  }
  const port = connect();
  const parts: ArrayBuffer[] = [];
  let offset = 0;
  try {
    for (;;) {
      const chunk = await requestChunk(port, descriptor.sessionId, offset, timeoutMs);
      if (chunk.sessionId !== descriptor.sessionId || chunk.offset !== offset) {
        throw new Error('媒体传输响应与请求不匹配');
      }
      const bytes = base64ToBytes(chunk.dataBase64);
      if (bytes.byteLength === 0 || bytes.byteLength > descriptor.chunkBytes) {
        throw new Error('媒体传输分块大小无效');
      }
      const nextOffset = offset + bytes.byteLength;
      if (nextOffset > descriptor.byteLength) {
        throw new Error('媒体传输数据超过声明大小');
      }
      if (chunk.done !== (nextOffset === descriptor.byteLength)) {
        throw new Error('媒体传输完成状态无效');
      }
      const part = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(part).set(bytes);
      parts.push(part);
      offset = nextOffset;
      if (chunk.done) {
        return new File(parts, descriptor.fileName, { type: descriptor.mimeType });
      }
    }
  } finally {
    try {
      port.postMessage({ type: 'CLOSE', sessionId: descriptor.sessionId });
    } catch {
      // 连接可能已经由背景服务关闭；仍继续执行本地 disconnect 清理。
    }
    try {
      port.disconnect();
    } catch {
      // 重复断开是无害的，finally 必须覆盖所有退出路径。
    }
  }
}
