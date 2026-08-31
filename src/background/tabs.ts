export interface BrowserTab {
  id: number;
  url?: string;
  active: boolean;
  windowId: number;
}

export type SourceTabSelection = { kind: 'reuse'; tabId: number } | { kind: 'create' };

export interface XianyuTabSelection {
  tabId: number;
  reusedActiveTab: boolean;
}

export interface TemporaryTabDependencies {
  create(url: string, active: boolean): Promise<BrowserTab>;
  remove(tabId: number): Promise<void>;
}

function comparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function isXianyuUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    return new URL(value).hostname.toLowerCase() === 'www.goofish.com';
  } catch {
    return false;
  }
}

function isXianyuLoginUrl(value: string | undefined): boolean {
  if (!isXianyuUrl(value) || value === undefined) {
    return false;
  }
  return new URL(value).pathname.startsWith('/login');
}

export function selectSourceTab(
  tabs: readonly BrowserTab[],
  targetUrl: string
): SourceTabSelection {
  const target = comparableUrl(targetUrl);
  if (target === null) {
    return { kind: 'create' };
  }
  const existing = tabs.find((tab) => tab.url !== undefined && comparableUrl(tab.url) === target);
  return existing === undefined ? { kind: 'create' } : { kind: 'reuse', tabId: existing.id };
}

export function selectXianyuTab(
  tabs: readonly BrowserTab[],
  activeTabId: number | undefined
): XianyuTabSelection | null {
  const active = tabs.find((tab) => tab.id === activeTabId && isXianyuUrl(tab.url));
  if (active !== undefined) {
    return { tabId: active.id, reusedActiveTab: true };
  }

  const existing = tabs.find((tab) => isXianyuUrl(tab.url));
  return existing === undefined
    ? null
    : { tabId: existing.id, reusedActiveTab: false };
}

export function selectXianyuLoginTab(tabs: readonly BrowserTab[]): number | null {
  return tabs.find((tab) => isXianyuLoginUrl(tab.url))?.id ?? null;
}

export async function withTemporaryTab<T>(
  dependencies: TemporaryTabDependencies,
  url: string,
  operation: (tab: BrowserTab) => Promise<T>
): Promise<T> {
  const tab = await dependencies.create(url, false);
  try {
    return await operation(tab);
  } finally {
    await dependencies.remove(tab.id);
  }
}

export async function withSourceTab<T>(
  dependencies: TemporaryTabDependencies,
  tabs: readonly BrowserTab[],
  url: string,
  operation: (tab: BrowserTab) => Promise<T>
): Promise<T> {
  const selection = selectSourceTab(tabs, url);
  if (selection.kind === 'reuse') {
    const tab = tabs.find((candidate) => candidate.id === selection.tabId);
    if (tab === undefined) {
      throw new Error('无法读取已有商品标签页');
    }
    return operation(tab);
  }
  return withTemporaryTab(dependencies, url, operation);
}
