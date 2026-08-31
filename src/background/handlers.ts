import { createAiClient } from '../ai/client';
import { normalizeHttpUrl } from './permissions';
import {
  selectSourceTab,
  selectXianyuTab,
  type BrowserTab
} from './tabs';
import type { AppError, AppErrorCode, OperationResult } from '../domain/errors';
import { runtimeMessageTypes, type RuntimeMessage } from '../domain/messages';
import type { ParsedProduct, ProductDraft } from '../domain/product';
import { createLocalStore, type StorageAreaLike } from '../storage/local-store';
import type { OperationStage } from '../storage/operation-log';
import { downloadSelectedImages, type FillResult } from '../xianyu/fill';
import type { XianyuLoginState } from '../xianyu/login';
import {
  prepareXianyuPublishTab,
  XIANYU_PUBLISH_URL,
  type XianyuTabDependencies
} from '../xianyu/tab-orchestrator';

const XIANYU_HOME_URL = 'https://www.goofish.com/';
const TAB_LOAD_TIMEOUT_MS = 30_000;

function createStorageArea(): StorageAreaLike {
  return {
    get: (keys) => browser.storage.local.get(keys),
    set: (items) => browser.storage.local.set(items),
    setAccessLevel: (options) => browser.storage.local.setAccessLevel(options)
  };
}

const store = createLocalStore(createStorageArea());
const aiClient = createAiClient(fetch);

function toBrowserTab(tab: Browser.tabs.Tab): BrowserTab | null {
  if (tab.id === undefined) {
    return null;
  }
  return {
    id: tab.id,
    ...(tab.url === undefined ? {} : { url: tab.url }),
    active: tab.active,
    windowId: tab.windowId
  };
}

async function listTabs(): Promise<BrowserTab[]> {
  return (await browser.tabs.query({}))
    .map(toBrowserTab)
    .filter((tab): tab is BrowserTab => tab !== null);
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const current = await browser.tabs.get(tabId);
  if (current.status === 'complete') {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时，请检查网络后重试'));
    }, TAB_LOAD_TIMEOUT_MS);
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    browser.tabs.onUpdated.addListener(listener);
  });
}

function xianyuTabDependencies(): XianyuTabDependencies {
  return {
    listTabs,
    async getActiveTabId(): Promise<number | undefined> {
      return (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
    },
    async update(tabId, options): Promise<BrowserTab> {
      const tab = await browser.tabs.update(tabId, options);
      if (tab === undefined) {
        throw new Error('无法更新闲鱼标签页');
      }
      const mapped = toBrowserTab(tab);
      if (mapped === null) {
        throw new Error('闲鱼标签页缺少有效标识');
      }
      return mapped;
    },
    async create(options): Promise<BrowserTab> {
      const tab = await browser.tabs.create(options);
      const mapped = toBrowserTab(tab);
      if (mapped === null) {
        throw new Error('无法创建闲鱼标签页');
      }
      return mapped;
    },
    waitForComplete: waitForTabComplete
  };
}

async function extractProductFromTab(tabId: number): Promise<ParsedProduct> {
  await browser.scripting.executeScript({
    target: { tabId },
    files: ['/product-extractor.js']
  });
  return browser.tabs.sendMessage(tabId, { type: 'EXTRACT_PRODUCT_DOCUMENT' });
}

async function parseProduct(url: string): Promise<ParsedProduct> {
  const normalized = normalizeHttpUrl(url);
  const tabs = await listTabs();
  const selection = selectSourceTab(tabs, normalized.href);
  if (selection.kind === 'reuse') {
    await waitForTabComplete(selection.tabId);
    return extractProductFromTab(selection.tabId);
  }
  const created = await browser.tabs.create({ url: normalized.href, active: false });
  if (created.id === undefined) {
    throw new Error('无法创建商品解析标签页');
  }
  try {
    await waitForTabComplete(created.id);
    return await extractProductFromTab(created.id);
  } finally {
    await browser.tabs.remove(created.id).catch(() => undefined);
  }
}

async function checkXianyuLogin(): Promise<XianyuLoginState> {
  const tabs = await listTabs();
  const activeTabId = (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
  const selection = selectXianyuTab(tabs, activeTabId);
  if (selection === null) {
    return 'unknown';
  }
  try {
    return await browser.tabs.sendMessage(selection.tabId, { type: 'CHECK_XIANYU_LOGIN' });
  } catch {
    return 'unknown';
  }
}

function validateDraft(draft: ProductDraft): number {
  if (draft.title.trim().length === 0 || draft.description.trim().length === 0) {
    throw new Error('请先填写标题和描述');
  }
  if (draft.price === null || !Number.isFinite(draft.price) || draft.price <= 0) {
    throw new Error('请填写有效售价');
  }
  if (!draft.images.some((image) => image.selected)) {
    throw new Error('请至少选择一张商品图片');
  }
  return draft.price;
}

function isFillResult(value: unknown): value is OperationResult<FillResult> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

async function fillDraft(draft: ProductDraft): Promise<FillResult> {
  const price = validateDraft(draft);
  const tab = await prepareXianyuPublishTab(xianyuTabDependencies());
  const loginState: XianyuLoginState = await browser.tabs.sendMessage(tab.tabId, {
    type: 'CHECK_XIANYU_LOGIN'
  });
  if (loginState === 'logged-out') {
    throw new Error('需要登录闲鱼');
  }
  if (loginState !== 'logged-in') {
    throw new Error('无法确认闲鱼登录状态，请在闲鱼页面检查后重试');
  }

  const downloaded = await downloadSelectedImages(fetch, draft.images);
  if (downloaded.files.length === 0) {
    throw new Error(downloaded.failures.at(0)?.message ?? '没有可上传图片');
  }
  const response: unknown = await browser.tabs.sendMessage(tab.tabId, {
    type: 'FILL_XIANYU_FORM',
    payload: {
      title: draft.title,
      description: draft.description,
      price,
      ...(draft.originalPrice === undefined ? {} : { originalPrice: draft.originalPrice }),
      shippingMethod: draft.shippingMethod,
      categoryNote: draft.categoryNote,
      images: downloaded.files
    }
  });
  if (!isFillResult(response)) {
    throw new Error('闲鱼页面返回了无法识别的填写结果');
  }
  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return {
    ...response.value,
    warnings: [
      ...response.value.warnings,
      ...downloaded.failures.map((failure) => `${failure.id}：${failure.message}`)
    ]
  };
}

async function openXianyuLogin(): Promise<void> {
  const tabs = await listTabs();
  const activeTabId = (await browser.tabs.query({ active: true, currentWindow: true })).at(0)?.id;
  const existing = selectXianyuTab(tabs, activeTabId);
  if (existing === null) {
    await browser.tabs.create({ url: XIANYU_HOME_URL, active: true });
    return;
  }
  await browser.tabs.update(existing.tabId, { url: XIANYU_HOME_URL, active: true });
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    runtimeMessageTypes.includes(value.type as RuntimeMessage['type'])
  );
}

function appError(code: AppErrorCode, message: string): AppError {
  return {
    code,
    message,
    recovery: '请检查侧边栏提示和当前页面后重试',
    draftPreserved: true
  };
}

function codeFor(message: RuntimeMessage, error: unknown): AppErrorCode {
  if (message.type === 'PARSE_PRODUCT') {
    return error instanceof Error && error.message.includes('URL') ? 'INVALID_URL' : 'PARSE_FAILED';
  }
  if (message.type === 'TEST_AI_CONNECTION' || message.type === 'EXPAND_DRAFT') {
    if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
      return error.code as AppErrorCode;
    }
    return 'AI_NETWORK_ERROR';
  }
  if (message.type === 'FILL_XIANYU_DRAFT') {
    return error instanceof Error && error.message.includes('登录')
      ? 'XIANYU_LOGGED_OUT'
      : 'XIANYU_FILL_FAILED';
  }
  return 'OPERATION_CANCELLED';
}

function stageFor(message: RuntimeMessage): OperationStage {
  if (message.type === 'PARSE_PRODUCT') return 'parse';
  if (message.type === 'TEST_AI_CONNECTION' || message.type === 'EXPAND_DRAFT') return 'ai';
  if (message.type === 'CHECK_XIANYU_LOGIN' || message.type === 'OPEN_XIANYU_LOGIN') return 'login';
  return 'fill';
}

async function handleRuntimeMessage(message: RuntimeMessage): Promise<OperationResult<unknown>> {
  try {
    let value: unknown;
    switch (message.type) {
      case 'PARSE_PRODUCT':
        value = await parseProduct(message.url);
        break;
      case 'TEST_AI_CONNECTION':
        value = await aiClient.testConnection(message.settings);
        break;
      case 'EXPAND_DRAFT':
        value = await aiClient.expandDraft(message.settings, message.draft);
        break;
      case 'CHECK_XIANYU_LOGIN':
        value = await checkXianyuLogin();
        break;
      case 'FILL_XIANYU_DRAFT':
        value = await fillDraft(message.draft);
        break;
      case 'OPEN_XIANYU_LOGIN':
        await openXianyuLogin();
        value = undefined;
        break;
    }
    await store.appendLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      stage: stageFor(message),
      outcome: 'success',
      message: `${message.type} 已完成`
    });
    return { ok: true, value };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : '操作失败';
    const code = codeFor(message, error);
    await store.appendLog({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      stage: stageFor(message),
      outcome: 'failure',
      message: messageText,
      code
    });
    return { ok: false, error: appError(code, messageText) };
  }
}

export function registerBackgroundHandlers(): void {
  void store.initialize();
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRuntimeMessage(message)) {
      return undefined;
    }
    void handleRuntimeMessage(message).then(sendResponse);
    return true;
  });
}

export { XIANYU_PUBLISH_URL };
