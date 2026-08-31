import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import { isAiSettings, parseStoredProductDraft } from '../domain/messages';
import { appendOperationLog, type OperationLogEntry } from './operation-log';

const SETTINGS_KEY = 'aiSettings';
const DRAFT_KEY = 'productDraft';
const LOGS_KEY = 'operationLogs';

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface LocalStore {
  initialize(): Promise<void>;
  getSettings(): Promise<AiSettings | null>;
  saveSettings(settings: AiSettings): Promise<void>;
  getDraft(): Promise<ProductDraft | null>;
  saveDraft(draft: ProductDraft): Promise<void>;
  clearDraft(): Promise<void>;
  getLogs(): Promise<OperationLogEntry[]>;
  appendLog(entry: OperationLogEntry): Promise<void>;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

async function readValue<T>(storageArea: StorageAreaLike, key: string): Promise<T | null> {
  const values = await storageArea.get(key);
  const value = values[key];
  return value === undefined ? null : cloneValue(value as T);
}

export function createLocalStore(storageArea: StorageAreaLike): LocalStore {
  return {
    async initialize(): Promise<void> {
      await storageArea.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
    },

    async getSettings(): Promise<AiSettings | null> {
      const value = await readValue<unknown>(storageArea, SETTINGS_KEY);
      return isAiSettings(value) ? value : null;
    },

    async saveSettings(settings: AiSettings): Promise<void> {
      await storageArea.set({ [SETTINGS_KEY]: cloneValue(settings) });
    },

    async getDraft(): Promise<ProductDraft | null> {
      const value = await readValue<unknown>(storageArea, DRAFT_KEY);
      const result = parseStoredProductDraft(value);
      if (result === null) {
        return null;
      }
      if (result.migrated) {
        await storageArea.set({ [DRAFT_KEY]: cloneValue(result.draft) });
      }
      return result.draft;
    },

    async saveDraft(draft: ProductDraft): Promise<void> {
      await storageArea.set({ [DRAFT_KEY]: cloneValue(draft) });
    },

    async clearDraft(): Promise<void> {
      await storageArea.remove(DRAFT_KEY);
    },

    async getLogs(): Promise<OperationLogEntry[]> {
      return (await readValue<OperationLogEntry[]>(storageArea, LOGS_KEY)) ?? [];
    },

    async appendLog(entry: OperationLogEntry): Promise<void> {
      const existing = await this.getLogs();
      await storageArea.set({ [LOGS_KEY]: appendOperationLog(existing, entry) });
    }
  };
}
