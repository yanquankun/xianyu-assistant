import type { AiConnectionResult } from '../ai/client';
import type { ExpansionPreview } from '../ai/validation';
import { getRequestedOrigin, normalizeHttpUrl } from '../background/permissions';
import type { OperationResult } from '../domain/errors';
import type { RuntimeMessage } from '../domain/messages';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import type { AiSettings } from '../domain/settings';
import { createLocalStore, type StorageAreaLike } from '../storage/local-store';
import type { OperationLogEntry } from '../storage/operation-log';
import type { FillResult } from '../xianyu/fill';
import type { XianyuLoginState } from '../xianyu/login';
import type { PanelSide, SidePanelServices } from './App';

function storageArea(): StorageAreaLike {
  return {
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
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

function operationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `operation-${String(Date.now())}`;
}

function sourceOrigins(draft: ProductDraft): string[] {
  const origins: string[] = [];
  for (const image of draft.images.filter((candidate) => candidate.selected)) {
    const normalized = normalizeHttpUrl(image.url);
    origins.push(getRequestedOrigin(normalized.url));
  }
  return origins;
}

export function createBrowserSidePanelServices(): SidePanelServices {
  const store = createLocalStore(storageArea());
  return {
    loadSettings(): Promise<AiSettings | null> {
      return store.getSettings();
    },

    saveSettings(settings: AiSettings): Promise<void> {
      return store.saveSettings(settings);
    },

    async parseProduct(url: string): Promise<ParsedProduct> {
      const normalized = normalizeHttpUrl(url);
      await requestOrigins([getRequestedOrigin(normalized.url)]);
      return send<ParsedProduct>({
        type: 'PARSE_PRODUCT',
        operationId: operationId(),
        url: normalized.href
      });
    },

    async testAiConnection(settings: AiSettings): Promise<AiConnectionResult> {
      const url = normalizeHttpUrl(settings.baseUrl);
      await requestOrigins([getRequestedOrigin(url.url)]);
      return send<AiConnectionResult>({ type: 'TEST_AI_CONNECTION', settings });
    },

    async expandDraft(settings: AiSettings, draft: ProductDraft): Promise<ExpansionPreview> {
      const url = normalizeHttpUrl(settings.baseUrl);
      await requestOrigins([getRequestedOrigin(url.url)]);
      return send<ExpansionPreview>({ type: 'EXPAND_DRAFT', settings, draft });
    },

    checkXianyuLogin(): Promise<XianyuLoginState> {
      return send<XianyuLoginState>({ type: 'CHECK_XIANYU_LOGIN' });
    },

    async fillDraft(draft: ProductDraft): Promise<FillResult> {
      await requestOrigins(sourceOrigins(draft));
      return send<FillResult>({ type: 'FILL_XIANYU_DRAFT', draft });
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
