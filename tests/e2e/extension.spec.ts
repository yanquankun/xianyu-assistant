import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

import { startFixtureServer, type FixtureServer } from './fixtures-server';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_PATH = resolve(PROJECT_ROOT, '.output/chrome-mv3-e2e');

async function extensionId(context: BrowserContext): Promise<string> {
  const worker = context.serviceWorkers().at(0) ?? (await context.waitForEvent('serviceworker'));
  return new URL(worker.url()).host;
}

async function openSidePanelPage(context: BrowserContext): Promise<Page> {
  const id = await extensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  return page;
}

test.describe('闲鱼上架助手扩展', () => {
  let context: BrowserContext | undefined;
  let fixtureServer: FixtureServer;
  let taobaoHtml: string;
  let loggedOutHtml: string;
  let publishHtml: string;

  test.beforeAll(async () => {
    fixtureServer = await startFixtureServer();
    [taobaoHtml, loggedOutHtml, publishHtml] = await Promise.all([
      readFile(resolve(PROJECT_ROOT, 'tests/fixtures/taobao-product.html'), 'utf8'),
      readFile(resolve(PROJECT_ROOT, 'tests/fixtures/xianyu-logged-out.html'), 'utf8'),
      readFile(resolve(PROJECT_ROOT, 'tests/fixtures/xianyu-publish.html'), 'utf8')
    ]);
  });

  test.afterAll(async () => {
    await fixtureServer.close();
  });

  test.beforeEach(async () => {
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 440, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`]
    });
    await context.route('https://item.taobao.com/**', async (route) => {
      const html = taobaoHtml.replaceAll('https://img.example.com', fixtureServer.baseUrl);
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });
    await context.route('https://www.goofish.com/**', async (route) => {
      const isLogin = new URL(route.request().url()).pathname.startsWith('/login');
      const body = isLogin
        ? loggedOutHtml
        : publishHtml.replace(
            '</body>',
            '<script>globalThis.__publishClicks = 0; document.querySelector("[data-testid=publish]").addEventListener("click", () => { globalThis.__publishClicks += 1; });</script></body>'
          );
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    });
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('解析、AI 预览、登录提醒和安全填表形成完整链路', async ({ browserName }, testInfo) => {
    test.setTimeout(60_000);
    expect(browserName).toBe('chromium');
    if (context === undefined) {
      throw new Error('隔离浏览器上下文未创建');
    }
    const xianyuPage = await context.newPage();
    await xianyuPage.goto('https://www.goofish.com/login');

    let panel = await openSidePanelPage(context);
    await expect(panel.getByText('需要登录闲鱼')).toBeVisible();
    await expect(panel.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
    await expect(panel.getByText('最终发布需在闲鱼页面手动完成')).toBeVisible();

    await xianyuPage.goto('https://www.goofish.com/publish');
    await panel.close();
    panel = await openSidePanelPage(context);
    await expect(panel.getByText('闲鱼已登录')).toBeVisible();

    await panel.getByRole('button', { name: 'AI 配置' }).click();
    await panel.getByLabel('Base URL').fill(`${fixtureServer.baseUrl}/v1`);
    await panel.getByLabel('API Key').fill('e2e-test-key');
    await panel.getByLabel('Model').fill('fixture-model');
    await panel.getByRole('button', { name: '保存配置' }).click();
    await expect(panel.getByText('配置已保存在当前浏览器')).toBeVisible();
    await panel.getByRole('button', { name: '测试连接' }).click();
    await expect(panel.getByText('连接成功，模型：fixture-model')).toBeVisible();

    const sourceUrl = 'https://item.taobao.com/item.htm?id=1';
    const sourcePage = await context.newPage();
    await sourcePage.goto(sourceUrl);
    await expect(sourcePage.locator('script[type="application/ld+json"]')).toHaveCount(1);

    await panel.getByRole('button', { name: '商品整理' }).click();
    await panel.getByLabel('商品链接').fill(sourceUrl);
    await panel.getByRole('button', { name: '解析商品' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('测试商品');
    await expect(panel.getByRole('img', { name: '商品图片 1' })).toBeVisible();

    await panel.getByRole('button', { name: 'AI 扩写' }).click();
    await expect(panel.getByRole('heading', { name: 'AI 文案预览' })).toBeVisible();
    await expect(panel.getByText('AI 整理后的测试商品')).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath('侧边栏-AI-预览.png'), fullPage: true });
    await panel.getByRole('button', { name: '应用此文案' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('AI 整理后的测试商品');

    await panel.getByRole('button', { name: '填入闲鱼' }).click();
    await expect(panel.getByText('内容已填入闲鱼，请检查页面并手动发布')).toBeVisible();
    await expect(xianyuPage.locator('input[name="title"]')).toHaveValue('AI 整理后的测试商品');
    await expect(xianyuPage.locator('input[name="price"]')).toHaveValue('99.9');
    await expect(xianyuPage.locator('textarea[name="description"]')).toHaveValue(
      '商品信息已整理，请以当前页面和实物为准。'
    );
    await expect(xianyuPage.locator('input[name="images"]')).toHaveJSProperty('files.length', 2);
    await expect(xianyuPage.getByTestId('publish')).toBeVisible();
    expect(
      await xianyuPage.evaluate(() => {
        const value: unknown = Reflect.get(globalThis, '__publishClicks');
        return typeof value === 'number' ? value : -1;
      })
    ).toBe(0);
    expect(fixtureServer.requests.length).toBeGreaterThanOrEqual(2);
  });
});
