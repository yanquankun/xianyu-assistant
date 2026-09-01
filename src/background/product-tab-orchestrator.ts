import { parseProductIdentity, type ProductIdentity } from '../domain/product-url';
import type { SettledBrowserTab } from './tab-settle';
import {
  selectProductSourceTab,
  type BrowserTab,
  type SourceTabSelection
} from './tabs';

export interface ProductTabOrchestratorDependencies {
  listTabs(): Promise<BrowserTab[]>;
  create(url: string, active: boolean): Promise<BrowserTab>;
  remove(tabId: number): Promise<void>;
  waitForSettled(tabId: number, submittedUrl: string): Promise<SettledBrowserTab>;
  prepare(tabId: number): Promise<void>;
  waitForReady(tabId: number): Promise<void>;
}

function selectedTab(
  tabs: readonly BrowserTab[],
  selection: SourceTabSelection
): BrowserTab | null {
  if (selection.kind === 'create') {
    return null;
  }
  return tabs.find((tab) => tab.id === selection.tabId) ?? null;
}

function requireProductIdentity(url: string | undefined): ProductIdentity {
  const identity = url === undefined ? null : parseProductIdentity(url);
  if (identity === null) {
    throw new Error('未识别到有效商品页面，请确认链接后重试');
  }
  return identity;
}

export async function withResolvedProductTab<T>(
  dependencies: ProductTabOrchestratorDependencies,
  submittedUrl: string,
  operation: (tabId: number, identity: ProductIdentity) => Promise<T>
): Promise<T> {
  const initialTabs = await dependencies.listTabs();
  const submittedIdentity = parseProductIdentity(submittedUrl);
  const initialSelection =
    submittedIdentity === null
      ? ({ kind: 'create' } as const)
      : selectProductSourceTab(initialTabs, submittedIdentity);
  let targetTab = selectedTab(initialTabs, initialSelection);
  let temporaryTabId: number | undefined;

  if (targetTab === null) {
    targetTab = await dependencies.create(submittedUrl, false);
    temporaryTabId = targetTab.id;
  }

  try {
    let settled = await dependencies.waitForSettled(targetTab.id, submittedUrl);
    let identity = requireProductIdentity(settled.url);

    if (temporaryTabId !== undefined) {
      const currentTabs = await dependencies.listTabs();
      const replacement = selectedTab(
        currentTabs,
        selectProductSourceTab(currentTabs, identity, temporaryTabId)
      );
      if (replacement !== null) {
        targetTab = replacement;
        settled = await dependencies.waitForSettled(
          replacement.id,
          replacement.url ?? identity.canonicalUrl
        );
        identity = requireProductIdentity(settled.url);
      }
    }

    await dependencies.prepare(targetTab.id);
    await dependencies.waitForReady(targetTab.id);
    return await operation(targetTab.id, identity);
  } finally {
    if (temporaryTabId !== undefined) {
      await dependencies.remove(temporaryTabId);
    }
  }
}
