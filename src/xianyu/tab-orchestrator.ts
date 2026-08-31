import { selectXianyuTab, type BrowserTab } from '../background/tabs';

export const XIANYU_PUBLISH_URL = 'https://www.goofish.com/publish';

export interface TabMutationOptions {
  url: string;
  active: boolean;
}

export interface XianyuTabDependencies {
  listTabs(): Promise<BrowserTab[]>;
  getActiveTabId(): Promise<number | undefined>;
  update(tabId: number, options: TabMutationOptions): Promise<BrowserTab>;
  create(options: TabMutationOptions): Promise<BrowserTab>;
  waitForComplete(tabId: number): Promise<void>;
}

export interface XianyuTabResult {
  tabId: number;
  reusedActiveTab: boolean;
  createdTab: boolean;
  navigatedToPublish: boolean;
}

function isPublishPage(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase() === 'www.goofish.com' && url.pathname.startsWith('/publish');
  } catch {
    return false;
  }
}

export async function prepareXianyuPublishTab(
  dependencies: XianyuTabDependencies
): Promise<XianyuTabResult> {
  const [tabs, activeTabId] = await Promise.all([
    dependencies.listTabs(),
    dependencies.getActiveTabId()
  ]);
  const selection = selectXianyuTab(tabs, activeTabId);
  if (selection === null) {
    const created = await dependencies.create({ url: XIANYU_PUBLISH_URL, active: true });
    await dependencies.waitForComplete(created.id);
    return {
      tabId: created.id,
      reusedActiveTab: false,
      createdTab: true,
      navigatedToPublish: true
    };
  }

  const selectedTab = tabs.find((tab) => tab.id === selection.tabId);
  const alreadyActivePublishPage =
    selection.reusedActiveTab && isPublishPage(selectedTab?.url);
  if (alreadyActivePublishPage) {
    return {
      tabId: selection.tabId,
      reusedActiveTab: true,
      createdTab: false,
      navigatedToPublish: false
    };
  }

  await dependencies.update(selection.tabId, { url: XIANYU_PUBLISH_URL, active: true });
  await dependencies.waitForComplete(selection.tabId);
  return {
    tabId: selection.tabId,
    reusedActiveTab: selection.reusedActiveTab,
    createdTab: false,
    navigatedToPublish: !isPublishPage(selectedTab?.url)
  };
}
