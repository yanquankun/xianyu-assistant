const DATABASE_NAME = 'xianyu-assistant-media';
const DATABASE_VERSION = 1;
const ASSETS_STORE_NAME = 'assets';

export type StoredMediaKind = 'image' | 'video';

export interface StoredMediaMetadata {
  assetId: string;
  kind: StoredMediaKind;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
}

export interface StoredMediaAsset extends StoredMediaMetadata {
  blob: Blob;
}

export interface MediaStore {
  save(file: File, kind: StoredMediaKind): Promise<StoredMediaMetadata>;
  get(assetId: string): Promise<StoredMediaAsset | null>;
  delete(assetId: string): Promise<void>;
  deleteMany(assetIds: readonly string[]): Promise<void>;
  cleanupExcept(referencedAssetIds: ReadonlySet<string>): Promise<void>;
}

type RequestRegistrar = <T>(request: IDBRequest<T>, onSuccess: (value: T) => void) => void;

type TransactionOperation<T> = (
  store: IDBObjectStore,
  complete: (value: T) => void,
  registerRequest: RequestRegistrar
) => void;

function createStorageError(message: '本地媒体保存失败' | '本地媒体读取失败'): Error {
  return new Error(message);
}

function openDatabase(
  factory: IDBFactory,
  message: '本地媒体保存失败' | '本地媒体读取失败'
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      reject(createStorageError(message));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSETS_STORE_NAME)) {
        database.createObjectStore(ASSETS_STORE_NAME, { keyPath: 'assetId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(createStorageError(message));
    request.onblocked = () => reject(createStorageError(message));
  });
}

function runTransaction<T>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  message: '本地媒体保存失败' | '本地媒体读取失败',
  operation: TransactionOperation<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(ASSETS_STORE_NAME, mode);
    } catch {
      reject(createStorageError(message));
      return;
    }

    let value: T | undefined;
    let hasValue = false;
    let failed = false;
    let settled = false;

    const rejectSafely = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(createStorageError(message));
    };

    const abortTransaction = () => {
      failed = true;
      try {
        transaction.abort();
      } catch {
        rejectSafely();
      }
    };

    const registerRequest: RequestRegistrar = (request, onSuccess) => {
      request.onsuccess = () => onSuccess(request.result);
      request.onerror = abortTransaction;
    };

    transaction.onabort = rejectSafely;
    transaction.onerror = abortTransaction;
    transaction.oncomplete = () => {
      if (failed || !hasValue) {
        rejectSafely();
        return;
      }
      settled = true;
      resolve(value as T);
    };

    try {
      operation(transaction.objectStore(ASSETS_STORE_NAME), (result) => {
        value = result;
        hasValue = true;
      }, registerRequest);
    } catch {
      abortTransaction();
    }

  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCreatedAt(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isBlob(value: unknown): value is Blob {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const blob = value as {
    arrayBuffer?: unknown;
    size?: unknown;
    slice?: unknown;
    stream?: unknown;
    text?: unknown;
    type?: unknown;
  };
  const tag = Object.prototype.toString.call(value);
  return (
    (tag === '[object Blob]' || tag === '[object File]') &&
    typeof blob.size === 'number' &&
    Number.isFinite(blob.size) &&
    blob.size >= 0 &&
    typeof blob.type === 'string' &&
    typeof blob.arrayBuffer === 'function' &&
    typeof blob.slice === 'function' &&
    typeof blob.stream === 'function' &&
    typeof blob.text === 'function'
  );
}

function isStoredMediaAsset(value: unknown): value is StoredMediaAsset {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const blob = record.blob;
  return (
    isNonEmptyString(record.assetId) &&
    (record.kind === 'image' || record.kind === 'video') &&
    isNonEmptyString(record.fileName) &&
    isNonEmptyString(record.mimeType) &&
    typeof record.byteLength === 'number' &&
    Number.isFinite(record.byteLength) &&
    record.byteLength >= 0 &&
    isValidCreatedAt(record.createdAt) &&
    isBlob(blob) &&
    record.byteLength === blob.size
  );
}

export function createMediaStore(
  factory: IDBFactory = indexedDB,
  createId: () => string = () => crypto.randomUUID()
): MediaStore {
  async function withDatabase<T>(
    message: '本地媒体保存失败' | '本地媒体读取失败',
    operation: (database: IDBDatabase) => Promise<T>
  ): Promise<T> {
    const database = await openDatabase(factory, message);
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  }

  return {
    async save(file: File, kind: StoredMediaKind): Promise<StoredMediaMetadata> {
      const metadata: StoredMediaMetadata = {
        assetId: createId(),
        kind,
        fileName: file.name,
        mimeType: file.type,
        byteLength: file.size,
        createdAt: new Date().toISOString()
      };
      const asset: StoredMediaAsset = { ...metadata, blob: file };

      return withDatabase('本地媒体保存失败', (database) =>
        runTransaction(database, 'readwrite', '本地媒体保存失败', (store, complete, registerRequest) => {
          const request = store.add(asset);
          registerRequest(request, () => complete(metadata));
        })
      );
    },

    async get(assetId: string): Promise<StoredMediaAsset | null> {
      return withDatabase('本地媒体读取失败', (database) =>
        runTransaction(database, 'readonly', '本地媒体读取失败', (store, complete, registerRequest) => {
          const request = store.get(assetId);
          registerRequest(request, (result) => {
            complete(isStoredMediaAsset(result) ? result : null);
          });
        })
      );
    },

    async delete(assetId: string): Promise<void> {
      await withDatabase('本地媒体保存失败', (database) =>
        runTransaction(database, 'readwrite', '本地媒体保存失败', (store, complete, registerRequest) => {
          const request = store.delete(assetId);
          registerRequest(request, () => complete(undefined));
        })
      );
    },

    async deleteMany(assetIds: readonly string[]): Promise<void> {
      if (assetIds.length === 0) {
        return;
      }
      await withDatabase('本地媒体保存失败', (database) =>
        runTransaction(database, 'readwrite', '本地媒体保存失败', (store, complete, registerRequest) => {
          let remaining = assetIds.length;
          for (const assetId of assetIds) {
            const request = store.delete(assetId);
            registerRequest(request, () => {
              remaining -= 1;
              if (remaining === 0) {
                complete(undefined);
              }
            });
          }
        })
      );
    },

    async cleanupExcept(referencedAssetIds: ReadonlySet<string>): Promise<void> {
      await withDatabase('本地媒体保存失败', (database) =>
        runTransaction(database, 'readwrite', '本地媒体保存失败', (store, complete, registerRequest) => {
          const request = store.openCursor();
          registerRequest(request, (cursor) => {
            if (cursor === null) {
              complete(undefined);
              return;
            }
            const assetId = typeof cursor.key === 'string' ? cursor.key : null;
            if (assetId !== null && referencedAssetIds.has(assetId)) {
              cursor.continue();
              return;
            }
            const deleteRequest = cursor.delete();
            registerRequest(deleteRequest, () => cursor.continue());
          });
        })
      );
    }
  };
}
