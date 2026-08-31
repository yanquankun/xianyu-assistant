import type { ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';

const SETTINGS_KEY = 'aiSettings';
const DRAFT_KEY = 'productDraft';

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface LocalStore {
  initialize(): Promise<void>;
  getSettings(): Promise<AiSettings | null>;
  saveSettings(settings: AiSettings): Promise<void>;
  getDraft(): Promise<ProductDraft | null>;
  saveDraft(draft: ProductDraft): Promise<void>;
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

    getSettings(): Promise<AiSettings | null> {
      return readValue<AiSettings>(storageArea, SETTINGS_KEY);
    },

    async saveSettings(settings: AiSettings): Promise<void> {
      await storageArea.set({ [SETTINGS_KEY]: cloneValue(settings) });
    },

    getDraft(): Promise<ProductDraft | null> {
      return readValue<ProductDraft>(storageArea, DRAFT_KEY);
    },

    async saveDraft(draft: ProductDraft): Promise<void> {
      await storageArea.set({ [DRAFT_KEY]: cloneValue(draft) });
    }
  };
}
