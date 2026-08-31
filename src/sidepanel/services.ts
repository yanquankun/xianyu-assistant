import { normalizeChatCompletionsUrl, type AiConnectionResult } from '../ai/client';
import { createFailureLogEntry } from '../background/operation-log-factory';
import type { ExpansionPreview } from '../ai/validation';
import { getRequestedOrigin, normalizeHttpUrl } from '../background/permissions';
import type { OperationResult } from '../domain/errors';
import type { RuntimeMessage } from '../domain/messages';
import { getRemoteImageUrl, type ParsedProduct, type ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import { createMediaStore } from '../storage/media-store';
import { createLocalStore, type LocalStore, type StorageAreaLike } from '../storage/local-store';
import type { OperationLogEntry } from '../storage/operation-log';
import type { FillResult } from '../xianyu/fill';
import {
  parseXianyuLoginCheckResult,
  type XianyuLoginCheckResult
} from '../xianyu/login';
import type { PanelSide, SidePanelServices } from './App';

function storageArea(): StorageAreaLike {
  return {
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
    remove: (keys) => browser.storage.local.remove(keys),
    setAccessLevel: (options) => browser.storage.local.setAccessLevel(options)
  };
}

async function send<T>(message: RuntimeMessage): Promise<T> {
  const response: unknown = await browser.runtime.sendMessage(message);
  if (
    typeof response !== 'object' ||
    response === null ||
    !('ok' in response) ||
    typeof response.ok !== 'boolean'
  ) {
    throw new Error('扩展后台返回了无法识别的结果');
  }
  const result = response as OperationResult<T>;
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

async function requestOrigins(origins: readonly string[]): Promise<void> {
  const unique = [...new Set(origins)];
  if (unique.length === 0) {
    return;
  }
  const alreadyGranted = await browser.permissions.contains({ origins: unique });
  if (alreadyGranted) {
    return;
  }
  const granted = await browser.permissions.request({ origins: unique });
  if (!granted) {
    throw new Error('未获得页面访问权限，草稿没有改变');
  }
}

async function requestOriginsWithLog(
  store: LocalStore,
  origins: readonly string[],
  message: RuntimeMessage
): Promise<void> {
  try {
    await requestOrigins(origins);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '站点访问权限未授权';
    try {
      await store.appendLog(
        createFailureLogEntry(
          message,
          errorMessage,
          'PERMISSION_DENIED',
          operationId(),
          new Date().toISOString()
        )
      );
    } catch {
      console.error('运行记录保存失败');
    }
    throw error;
  }
}

function operationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `operation-${String(Date.now())}`;
}

function sourceOrigins(draft: ProductDraft): string[] {
  const origins: string[] = [];
  for (const image of draft.images) {
    if (!image.selected || image.loadStatus !== 'loaded') {
      continue;
    }
    const remoteUrl = getRemoteImageUrl(image);
    if (remoteUrl === null) {
      continue;
    }
    const normalized = normalizeHttpUrl(remoteUrl);
    origins.push(getRequestedOrigin(normalized.url));
    if (origins.length === 9) {
      break;
    }
  }
  return origins;
}

export function createBrowserSidePanelServices(): SidePanelServices {
  const store = createLocalStore(storageArea());
  const mediaStore = createMediaStore(indexedDB);
  return {
    loadSettings(): Promise<AiSettings | null> {
      return store.getSettings();
    },

    saveSettings(settings: AiSettings): Promise<void> {
      return store.saveSettings(settings);
    },

    loadDraft(): Promise<ProductDraft | null> {
      return store.getDraft();
    },

    saveDraft(draft: ProductDraft): Promise<void> {
      return store.saveDraft(draft);
    },

    clearDraft(): Promise<void> {
      return store.clearDraft();
    },

    saveMedia(file, kind) {
      return mediaStore.save(file, kind);
    },

    loadMedia(assetId) {
      return mediaStore.get(assetId);
    },

    deleteMedia(assetId) {
      return mediaStore.delete(assetId);
    },

    cleanupMedia(referencedAssetIds) {
      return mediaStore.cleanupExcept(new Set(referencedAssetIds));
    },

    async parseProduct(url: string): Promise<ParsedProduct> {
      const normalized = normalizeHttpUrl(url);
      const message: RuntimeMessage = {
        type: 'PARSE_PRODUCT',
        operationId: operationId(),
        url: normalized.href
      };
      await requestOriginsWithLog(store, [getRequestedOrigin(normalized.url)], message);
      return send<ParsedProduct>(message);
    },

    async testAiConnection(settings: AiSettings): Promise<AiConnectionResult> {
      const url = normalizeChatCompletionsUrl(settings.baseUrl);
      const message: RuntimeMessage = { type: 'TEST_AI_CONNECTION', settings };
      await requestOriginsWithLog(store, [getRequestedOrigin(url)], message);
      return send<AiConnectionResult>(message);
    },

    async expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreview> {
      const url = normalizeChatCompletionsUrl(settings.baseUrl);
      const message: RuntimeMessage = { type: 'EXPAND_DRAFT', settings, draft };
      await requestOriginsWithLog(store, [getRequestedOrigin(url)], message);
      return send<ExpansionPreview>(message);
    },

    async checkXianyuLogin(): Promise<XianyuLoginCheckResult> {
      const value = await send<unknown>({ type: 'CHECK_XIANYU_LOGIN' });
      const result = parseXianyuLoginCheckResult(value);
      if (result === null) {
        throw new Error('扩展后台返回了无法识别的登录状态');
      }
      return result;
    },

    async fillDraft(draft: ProductDraft): Promise<FillResult> {
      const message: RuntimeMessage = { type: 'FILL_XIANYU_DRAFT', draft };
      await requestOriginsWithLog(store, sourceOrigins(draft), message);
      return send<FillResult>(message);
    },

    async openXianyuLogin(): Promise<void> {
      await send<unknown>({ type: 'OPEN_XIANYU_LOGIN' });
    },

    async getPanelSide(): Promise<PanelSide> {
      if (typeof browser.sidePanel.getLayout !== 'function') {
        return 'unknown';
      }
      const layout = await browser.sidePanel.getLayout();
      return layout.side;
    },

    loadLogs(): Promise<OperationLogEntry[]> {
      return store.getLogs();
    }
  };
}
