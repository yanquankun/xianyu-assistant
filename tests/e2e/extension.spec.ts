import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

import { startFixtureServer, type FixtureServer } from './fixtures-server';

const PROJECT_ROOT = resolve(import.meta.dirname, '../..');
const EXTENSION_PATH = resolve(PROJECT_ROOT, '.output/chrome-mv3-e2e');
const PRODUCTION_EXTENSION_PATH = resolve(PROJECT_ROOT, '.output/chrome-mv3');
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n2YAAAAASUVORK5CYII=',
  'base64'
);

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

async function configureAi(panel: Page, fixtureServer: FixtureServer): Promise<void> {
  await panel.getByRole('button', { name: 'AI 配置' }).click();
  await panel.getByLabel('Base URL').fill(`${fixtureServer.baseUrl}/v1`);
  await panel.getByLabel('API Key').fill('e2e-test-key');
  await panel.getByLabel('Model').fill('fixture-model');
  await panel.getByRole('button', { name: '保存配置' }).click();
  await expect(panel.getByText('配置已保存在当前浏览器')).toBeVisible();
  await panel.getByRole('button', { name: '商品整理' }).click();
}

async function readStoredDraft(panel: Page): Promise<unknown> {
  return panel.evaluate(async () => {
    const values = await browser.storage.local.get('productDraft');
    return values.productDraft;
  });
}

function titlelessProductHtml(canonicalUrl: string, imageBaseUrl: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:description" content="分享文案后备标题夹具" />
    <meta property="og:image" content="${imageBaseUrl}/image.png" />
    <meta property="product:price:amount" content="88.00" />
    <meta property="product:price:currency" content="CNY" />
  </head>
  <body>
    <main>本地商品夹具</main>
    <div data-price-region="product"><span data-sale-price>88.00</span></div>
  </body>
</html>`;
}

test.describe('闲鱼上架助手扩展', () => {
  let context: BrowserContext | undefined;
  let fixtureServer: FixtureServer;
  let taobaoHtml: string;
  let jdHtml: string;
  let loggedOutHtml: string;
  let publishHtml: string;

  test.beforeAll(async () => {
    fixtureServer = await startFixtureServer();
    [taobaoHtml, jdHtml, loggedOutHtml, publishHtml] = await Promise.all([
      readFile(resolve(PROJECT_ROOT, 'tests/fixtures/taobao-product.html'), 'utf8'),
      readFile(resolve(PROJECT_ROOT, 'tests/fixtures/jd-product.html'), 'utf8'),
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
      const url = route.request().url();
      const html = new URL(url).searchParams.get('id') === '200'
        ? titlelessProductHtml(
            'https://item.taobao.com/item.htm?id=200',
            fixtureServer.baseUrl
          )
        : taobaoHtml.replaceAll('https://img.example.com', fixtureServer.baseUrl);
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    });
    await context.route('https://item.jd.com/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/400.html') {
        await route.fulfill({
          status: 400,
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><title>HTTP Status 400 – Bad Request</title><main>访问出错</main>'
        });
        return;
      }
      const html = jdHtml.replaceAll('//img.example.com', fixtureServer.baseUrl);
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

  test('AI 加载后直接回填，登录刷新并生成可展开的运行记录', async ({ browserName }) => {
    test.setTimeout(60_000);
    expect(browserName).toBe('chromium');
    if (context === undefined) {
      throw new Error('隔离浏览器上下文未创建');
    }
    const xianyuPage = await context.newPage();
    await xianyuPage.goto('https://www.goofish.com/login');
    const panel = await openSidePanelPage(context);

    await expect(panel.getByText('需要登录闲鱼', { exact: true })).toBeVisible();
    await xianyuPage.goto('https://www.goofish.com/publish');
    await panel.getByRole('button', { name: '刷新闲鱼登录状态' }).click();
    await expect(panel.getByText('闲鱼已登录', { exact: true }).first()).toBeVisible();

    await configureAi(panel, fixtureServer);
    const sourceUrl = 'https://item.taobao.com/item.htm?id=1';
    const sourcePage = await context.newPage();
    await sourcePage.goto(sourceUrl);
    await panel.getByLabel('商品链接').fill(sourceUrl);
    await panel.getByRole('button', { name: '解析商品' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('测试商品');

    await panel.getByRole('button', { name: 'AI 扩写' }).click();
    await expect(panel.getByRole('button', { name: 'AI 扩写中' })).toBeDisabled();
    await expect(panel.getByLabel('商品标题')).toHaveValue('AI 整理后的测试商品');
    await expect(panel.getByRole('heading', { name: 'AI 文案预览' })).toHaveCount(0);

    await panel.getByRole('button', { name: '运行记录' }).click();
    const aiLog = panel
      .locator('.log-list__toggle')
      .filter({ hasText: 'AI 整理后的测试商品' })
      .first();
    await expect(aiLog).toBeVisible();
    await aiLog.click();
    const details = panel.locator('.log-list__details').first();
    await expect(details).toContainText(sourceUrl);
    await expect(details).toContainText('AI 整理后的测试商品');
    await expect(details).toContainText('商品信息已整理，请以当前页面和实物为准。');
    expect(fixtureServer.requests.length).toBeGreaterThanOrEqual(1);
  });

  test('手动草稿显示步骤 02，取消返回保留内容，确认后不再恢复草稿', async ({ browserName }) => {
    expect(browserName).toBe('chromium');
    if (context === undefined) {
      throw new Error('隔离浏览器上下文未创建');
    }
    let panel = await openSidePanelPage(context);
    await panel.getByRole('button', { name: '手动填写' }).click();
    await expect(panel.locator('.editor-card .step-number')).toHaveText('02');
    await panel.getByLabel('商品标题').fill('取消返回后仍保留');

    await panel.getByRole('button', { name: '返回选择方式' }).click();
    await expect(panel.getByRole('dialog', { name: '返回选择方式' })).toBeVisible();
    await panel.getByRole('button', { name: '取消' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('取消返回后仍保留');

    await panel.getByRole('button', { name: '返回选择方式' }).click();
    await panel.getByRole('button', { name: '确认返回' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveCount(0);
    await expect(panel.getByLabel('商品链接')).toBeVisible();
    await expect(panel.getByRole('button', { name: '手动填写' })).toBeVisible();

    await panel.close();
    panel = await openSidePanelPage(context);
    await expect(panel.getByLabel('商品标题')).toHaveCount(0);
    await expect(panel.getByLabel('商品链接')).toBeVisible();
    await expect(panel.getByRole('button', { name: '手动填写' })).toBeVisible();
    await expect.poll(() => readStoredDraft(panel)).toBeUndefined();
  });

  test('两张本地图片可预览、持久化并安全填表，最终发布保持未点击', async ({ browserName }) => {
    test.setTimeout(60_000);
    expect(browserName).toBe('chromium');
    if (context === undefined) {
      throw new Error('隔离浏览器上下文未创建');
    }
    const xianyuPage = await context.newPage();
    await xianyuPage.goto('https://www.goofish.com/publish');
    let panel = await openSidePanelPage(context);
    await panel.getByRole('button', { name: '手动填写' }).click();
    await panel.getByLabel('商品标题').fill('本地图片商品');
    await panel.getByLabel('售价').fill('66');
    await panel.getByLabel('商品描述').fill('两张本地图片的测试描述');
    await panel.getByLabel('上传商品图片').setInputFiles([
      { name: '本地图片一.png', mimeType: 'image/png', buffer: PNG_BYTES },
      { name: '本地图片二.png', mimeType: 'image/png', buffer: PNG_BYTES }
    ]);
    await expect(panel.getByRole('img', { name: '商品图片 1' })).toBeVisible();
    await expect(panel.getByRole('img', { name: '商品图片 2' })).toBeVisible();
    await expect(panel.getByText('媒体 2/9')).toBeVisible();

    await panel.getByRole('button', { name: '预览商品图片 1' }).click();
    await expect(panel.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await panel.getByRole('button', { name: '关闭媒体预览' }).click();
    await expect(panel.getByRole('dialog', { name: '媒体预览' })).toHaveCount(0);

    await expect
      .poll(async () => {
        const draft = await readStoredDraft(panel);
        return typeof draft === 'object' &&
          draft !== null &&
          'images' in draft &&
          Array.isArray(draft.images)
          ? draft.images.length
          : 0;
      })
      .toBe(2);
    await panel.close();
    panel = await openSidePanelPage(context);
    await expect(panel.getByRole('img', { name: '商品图片 1' })).toBeVisible();
    await expect(panel.getByRole('img', { name: '商品图片 2' })).toBeVisible();
    await panel.getByRole('button', { name: '预览商品图片 2' }).click();
    await expect(panel.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
    await panel.keyboard.press('Escape');

    await panel.getByRole('button', { name: '填入闲鱼' }).click();
    await expect(panel.getByText('内容已填入闲鱼，请检查页面并手动发布')).toBeVisible();
    await expect(xianyuPage.locator('input[name="title"]')).toHaveValue('本地图片商品');
    await expect(xianyuPage.locator('input[name="images"]')).toHaveJSProperty('files.length', 2);
    const publishClicks: number | null = await xianyuPage.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __publishClicks?: unknown };
      return typeof scope.__publishClicks === 'number' ? scope.__publishClicks : null;
    });
    expect(publishClicks).toBe(0);
  });

  test('京东与淘宝完整分享文案使用匿名夹具，并拒绝错误页', async ({ browserName }) => {
    test.setTimeout(60_000);
    expect(browserName).toBe('chromium');
    if (context === undefined) {
      throw new Error('隔离浏览器上下文未创建');
    }
    const panel = await openSidePanelPage(context);

    const jdPage = await context.newPage();
    await jdPage.goto('https://item.jd.com/100.html');
    await panel
      .getByLabel('商品链接')
      .fill('京东分享「京东客户端商品」 https://item.jd.com/100.html CA1507');
    await panel.getByRole('button', { name: '解析商品' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('京东结构化商品', {
      timeout: 15_000
    });
    await expect
      .poll(() => readStoredDraft(panel))
      .toMatchObject({
        submittedUrl: 'https://item.jd.com/100.html',
        canonicalUrl: 'https://item.jd.com/100.html'
      });

    await panel.getByRole('button', { name: '返回选择方式' }).click();
    await panel.getByRole('button', { name: '确认返回' }).click();
    const taobaoPage = await context.newPage();
    await taobaoPage.goto('https://item.taobao.com/item.htm?id=200');
    await panel
      .getByLabel('商品链接')
      .fill('淘宝分享「淘宝分享标题」 https://item.taobao.com/item.htm?id=200 CZ009');
    await panel.getByRole('button', { name: '解析商品' }).click();
    await expect(panel.getByLabel('商品标题')).toHaveValue('淘宝分享标题', {
      timeout: 15_000
    });
    await expect(panel.getByText('标题来自分享文案，请核对')).toBeVisible();
    await expect
      .poll(() => readStoredDraft(panel))
      .toMatchObject({
        submittedUrl: 'https://item.taobao.com/item.htm?id=200',
        canonicalUrl: 'https://item.taobao.com/item.htm?id=200'
      });

    await panel.getByRole('button', { name: '返回选择方式' }).click();
    await panel.getByRole('button', { name: '确认返回' }).click();
    const errorPage = await context.newPage();
    await errorPage.goto('https://item.jd.com/400.html');
    await panel
      .getByLabel('商品链接')
      .fill('京东错误页「不能使用的标题」 https://item.jd.com/400.html');
    await panel.getByRole('button', { name: '解析商品' }).click();
    await expect(panel.getByText('商品页面返回 HTTP 400 错误')).toBeVisible();
    await expect(panel.getByLabel('商品标题')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '手动填写' })).toBeVisible();
  });

  test('生产构建可在独立 Chromium 中加载侧边栏入口', async ({ browserName }) => {
    expect(browserName).toBe('chromium');
    const productionContext = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 440, height: 900 },
      args: [
        `--disable-extensions-except=${PRODUCTION_EXTENSION_PATH}`,
        `--load-extension=${PRODUCTION_EXTENSION_PATH}`
      ]
    });
    try {
      const panel = await openSidePanelPage(productionContext);
      await expect(panel.getByText('闲鱼上架助手')).toBeVisible();
      await expect(panel.getByText('最终发布需在闲鱼页面手动完成')).toBeVisible();
    } finally {
      await productionContext.close();
    }
  });
});
