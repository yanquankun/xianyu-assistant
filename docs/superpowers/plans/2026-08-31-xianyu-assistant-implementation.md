# 闲鱼上架助手实施计划

> **面向执行者：** 必须在当前会话中使用 `superpowers:executing-plans`，按任务逐项执行；所有行为代码严格遵循测试先行。直接在 `main` 分支工作，不创建 worktree 或功能分支。

**目标：** 构建一个私有的 Chrome Manifest V3 扩展，把淘宝或京东商品链接整理为可编辑闲鱼草稿，支持 OpenAI 兼容接口扩写，并把用户确认过的内容填入闲鱼网页，但绝不点击最终发布按钮。

**架构：** 使用 WXT、React 和 TypeScript。Side Panel 负责编辑与反馈，Background Service Worker 负责权限、标签页和 AI 调用，商品解析脚本与闲鱼填写脚本分别隔离；共享领域模型负责跨上下文消息、草稿和错误类型。

**技术栈：** Node.js 24、pnpm 11、WXT 0.21.4、React 19.2.8、TypeScript 6.0.3、Vitest 4.1.11、Playwright 1.62.1、ESLint 10.9.1、Prettier 3.9.6。

**规格：** `docs/superpowers/specs/2026-08-31-xianyu-assistant-design.md`

## 全局约束

- 项目与 GitHub 仓库名均为 `xianyu-assistant`。
- 所有用户文档、界面文案和操作提示使用简体中文；代码标识符使用英文。
- 代码、注释、文档和界面不得使用 Emoji。
- CSS 尺寸使用 `rem`、`em`、`%`、`vw`、`vh`，不使用 `px`。
- 不使用 `any`、`@ts-ignore`、Cookie API、Debugger API、History API、`<all_urls>` 固定权限或任意代码执行接口。
- 商品来源首版重点支持淘宝、天猫和京东；其他 HTTP/HTTPS 商品页仅使用通用结构化数据解析。
- AI 仅支持 OpenAI 兼容 Chat Completions 请求，API Key 只保存在 `chrome.storage.local` 的可信扩展上下文。
- 自动化只填表，不实现、查找或点击闲鱼最终发布按钮。
- 所有提交直接进入本地 `main`，每个任务结束后提交一次可独立验证的变更。
- 创建远程仓库时必须指定 `--private`，远程目标固定为 `yanquankun/xianyu-assistant`。

## 文件结构

```text
xianyu-assistant/
├── assets/
│   └── icon-source.svg
├── entrypoints/
│   ├── background.ts
│   ├── product-extractor.ts
│   ├── xianyu.content.ts
│   └── sidepanel/
│       ├── index.html
│       ├── main.tsx
│       └── styles.css
├── public/
│   └── icon/
│       ├── 16.png
│       ├── 32.png
│       ├── 48.png
│       └── 128.png
├── src/
│   ├── ai/
│   │   ├── client.ts
│   │   ├── prompts.ts
│   │   └── validation.ts
│   ├── background/
│   │   ├── handlers.ts
│   │   ├── permissions.ts
│   │   └── tabs.ts
│   ├── domain/
│   │   ├── errors.ts
│   │   ├── messages.ts
│   │   ├── product.ts
│   │   └── settings.ts
│   ├── parsers/
│   │   ├── common.ts
│   │   ├── generic.ts
│   │   ├── jd.ts
│   │   ├── merge.ts
│   │   └── taobao.ts
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── state.ts
│   ├── storage/
│   │   ├── local-store.ts
│   │   └── operation-log.ts
│   └── xianyu/
│       ├── dom.ts
│       ├── fill.ts
│       ├── login.ts
│       └── tab-orchestrator.ts
├── tests/
│   ├── fixtures/
│   │   ├── jd-product.html
│   │   ├── taobao-product.html
│   │   ├── xianyu-logged-out.html
│   │   └── xianyu-publish.html
│   ├── unit/
│   └── e2e/
├── docs/superpowers/
├── eslint.config.js
├── package.json
├── playwright.config.ts
├── prettier.config.js
├── tsconfig.json
├── vitest.config.ts
└── wxt.config.ts
```

---

### 任务 1：创建 WXT 工程骨架与质量门禁

**文件：**
- 新建：`package.json`
- 新建：`pnpm-workspace.yaml`
- 新建：`tsconfig.json`
- 新建：`wxt.config.ts`
- 新建：`vitest.config.ts`
- 新建：`playwright.config.ts`
- 新建：`eslint.config.js`
- 新建：`prettier.config.js`
- 新建：`.gitignore`
- 新建：`assets/icon-source.svg`
- 生成：`public/icon/16.png`、`32.png`、`48.png`、`128.png`

**接口：**
- 产出：`pnpm dev`、`test`、`test:watch`、`test:e2e`、`lint`、`typecheck`、`check`、`build`、`zip` 命令。
- 产出：Manifest V3，固定权限为 `sidePanel`、`storage`、`activeTab`、`scripting`、`tabs`，固定站点权限仅为 `https://www.goofish.com/*`。

- [ ] **步骤 1：创建精确的包配置**

  在 `package.json` 中固定 Node 与 pnpm 版本，加入 WXT、React、TypeScript、Vitest、Testing Library、Playwright、ESLint 和 Prettier。脚本必须包含：

  ```json
  {
    "scripts": {
      "dev": "wxt",
      "test": "vitest run",
      "test:watch": "vitest",
      "test:e2e": "playwright test",
      "lint": "eslint .",
      "typecheck": "tsc --noEmit",
      "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
      "build": "wxt build",
      "zip": "wxt zip"
    }
  }
  ```

- [ ] **步骤 2：配置 Manifest 与入口**

  `wxt.config.ts` 必须声明 Chrome MV3、React 模块、中文扩展名、图标、固定权限、闲鱼固定站点权限，以及仅在运行时请求的 `http://*/*` 和 `https://*/*` 可选站点权限。

- [ ] **步骤 3：安装依赖并生成锁文件**

  运行：`pnpm install`

  预期：生成 `pnpm-lock.yaml`，安装过程退出码为 0。

- [ ] **步骤 4：验证空骨架可以生成 Manifest**

  运行：`pnpm exec wxt prepare && pnpm typecheck`

  预期：生成 `.wxt/tsconfig.json`，类型检查退出码为 0。

- [ ] **步骤 5：提交工程骨架**

  ```bash
  git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json wxt.config.ts vitest.config.ts playwright.config.ts eslint.config.js prettier.config.js .gitignore assets public
  git commit -m "chore: scaffold chrome extension"
  ```

### 任务 2：定义领域模型、本地存储与安全日志

**文件：**
- 新建：`src/domain/product.ts`
- 新建：`src/domain/settings.ts`
- 新建：`src/domain/errors.ts`
- 新建：`src/domain/messages.ts`
- 新建：`src/storage/local-store.ts`
- 新建：`src/storage/operation-log.ts`
- 测试：`tests/unit/storage.test.ts`
- 测试：`tests/unit/operation-log.test.ts`

**接口：**
- 产出：`ProductDraft`、`ProductImage`、`AiSettings`、`OperationResult<T>`、`RuntimeMessage`。
- 产出：`createLocalStore(storageArea)`，提供 `getSettings`、`saveSettings`、`getDraft`、`saveDraft`。
- 产出：`sanitizeLogEntry(input)` 与最大 100 条的本地运行记录。

- [ ] **步骤 1：先写存储失败测试**

  ```ts
  it('保存 AI 设置时不会把密钥写入运行日志', async () => {
    const store = createMemoryStore();
    await store.saveSettings({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-test',
      temperature: 0.3,
      systemInstruction: '',
    });
    store.appendLog({ stage: 'ai', message: 'Bearer secret-key' });
    expect(JSON.stringify(store.getLogs())).not.toContain('secret-key');
  });
  ```

- [ ] **步骤 2：运行测试并确认因模块缺失而失败**

  运行：`pnpm test tests/unit/storage.test.ts tests/unit/operation-log.test.ts`

  预期：失败原因是领域类型和存储实现尚不存在。

- [ ] **步骤 3：实现最小领域模型与存储**

  `ProductDraft` 必须包含来源平台、规范 URL、来源字段、可编辑字段、图片、警告、置信度和更新时间。`AiSettings` 的 `apiKey` 只能由 side panel 和 background 访问。初始化时调用 `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`。

- [ ] **步骤 4：实现日志脱敏与数量上限**

  脱敏 `Authorization`、Bearer Token、`apiKey`、URL 用户信息和 Cookie 字样；超过 100 条时保留最新记录。

- [ ] **步骤 5：运行测试并提交**

  运行：`pnpm test tests/unit/storage.test.ts tests/unit/operation-log.test.ts && pnpm typecheck`

  ```bash
  git add src/domain src/storage tests/unit/storage.test.ts tests/unit/operation-log.test.ts
  git commit -m "feat: add secure local domain storage"
  ```

### 任务 3：实现 URL 校验、运行时权限与标签页生命周期

**文件：**
- 新建：`src/background/permissions.ts`
- 新建：`src/background/tabs.ts`
- 测试：`tests/unit/permissions.test.ts`
- 测试：`tests/unit/tabs.test.ts`

**接口：**
- 产出：`normalizeHttpUrl(input: string): NormalizedUrl`。
- 产出：`getRequestedOrigin(url: URL): string`，只能返回 `scheme://host/*`。
- 产出：`selectSourceTab(tabs, targetUrl)` 与 `selectXianyuTab(tabs, activeTabId)`。
- 产出：`withTemporaryTab(deps, url, operation)`，只关闭由扩展创建的临时标签页。

- [ ] **步骤 1：写 URL 与权限失败测试**

  ```ts
  it.each(['javascript:alert(1)', 'file:///tmp/a', 'chrome://settings'])('拒绝非 HTTP URL：%s', (value) => {
    expect(() => normalizeHttpUrl(value)).toThrow('仅支持 HTTP 或 HTTPS 商品链接');
  });

  it('运行时只请求精确来源', () => {
    expect(getRequestedOrigin(new URL('https://item.jd.com/100.html?x=1'))).toBe('https://item.jd.com/*');
  });
  ```

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm test tests/unit/permissions.test.ts tests/unit/tabs.test.ts`

- [ ] **步骤 3：实现 URL、权限和标签页规则**

  URL 存储前移除用户名和密码。当前标签页 URL 与目标规范 URL 相同则复用；否则创建非激活临时标签页。`finally` 只能关闭返回值中 `createdByExtension: true` 的标签页。

- [ ] **步骤 4：运行绿灯并提交**

  运行：`pnpm test tests/unit/permissions.test.ts tests/unit/tabs.test.ts && pnpm typecheck`

  ```bash
  git add src/background tests/unit/permissions.test.ts tests/unit/tabs.test.ts
  git commit -m "feat: add safe url permissions and tab lifecycle"
  ```

### 任务 4：实现淘宝、京东与通用商品解析器

**文件：**
- 新建：`src/parsers/common.ts`
- 新建：`src/parsers/generic.ts`
- 新建：`src/parsers/taobao.ts`
- 新建：`src/parsers/jd.ts`
- 新建：`src/parsers/merge.ts`
- 新建：`entrypoints/product-extractor.ts`
- 新建：`tests/fixtures/taobao-product.html`
- 新建：`tests/fixtures/jd-product.html`
- 测试：`tests/unit/parsers.test.ts`

**接口：**
- 产出：`parseDocument(document, pageUrl): ParseCandidate[]`。
- 产出：`mergeProductCandidates(candidates): ParsedProduct`。
- 产出：注入脚本消息 `EXTRACT_PRODUCT`，返回结构化解析结果，不返回完整 HTML。

- [ ] **步骤 1：先建立匿名化页面夹具**

  淘宝夹具包含 JSON-LD 商品、Open Graph 图片和一个 DOM 价格；京东夹具包含 JSON-LD 商品、页面标题、价格和三张图片。夹具不复制第三方长篇商品文案，只保留最小测试结构。

- [ ] **步骤 2：写平台解析失败测试**

  ```ts
  it('从淘宝夹具合并标题、价格和去重图片', () => {
    const result = parseFixture('taobao-product.html', 'https://item.taobao.com/item.htm?id=1');
    expect(result.platform).toBe('taobao');
    expect(result.title).toBe('测试商品');
    expect(result.price).toBe(99.9);
    expect(result.images).toHaveLength(2);
  });

  it('从京东夹具读取结构化商品信息', () => {
    const result = parseFixture('jd-product.html', 'https://item.jd.com/1.html');
    expect(result.platform).toBe('jd');
    expect(result.currency).toBe('CNY');
    expect(result.images.every((image) => image.url.startsWith('https://'))).toBe(true);
  });
  ```

- [ ] **步骤 3：运行并确认红灯**

  运行：`pnpm test tests/unit/parsers.test.ts`

- [ ] **步骤 4：按优先级实现解析与合并**

  解析顺序固定为 JSON-LD `Product`、Open Graph、标准 Meta、平台 DOM。合并时结构化商品字段优先，平台 DOM 只补缺失字段；图片统一为 HTTPS、去参数化重复项并保留来源。

- [ ] **步骤 5：验证异常结构并提交**

  增加畸形 JSON-LD、缺少价格、相对图片 URL 和重复图片测试。

  运行：`pnpm test tests/unit/parsers.test.ts && pnpm typecheck`

  ```bash
  git add src/parsers entrypoints/product-extractor.ts tests/fixtures tests/unit/parsers.test.ts
  git commit -m "feat: parse taobao and jd product pages"
  ```

### 任务 5：实现 OpenAI 兼容配置、连接测试和事实约束扩写

**文件：**
- 新建：`src/ai/client.ts`
- 新建：`src/ai/prompts.ts`
- 新建：`src/ai/validation.ts`
- 测试：`tests/unit/ai-client.test.ts`
- 测试：`tests/unit/ai-validation.test.ts`

**接口：**
- 产出：`normalizeChatCompletionsUrl(baseUrl: string): URL`。
- 产出：`createAiClient(fetchImpl)`，提供 `testConnection(settings)` 与 `expandDraft(settings, draft)`。
- 产出：`validateExpansion(input, sourceFacts): ExpansionPreview`。

- [ ] **步骤 1：写请求构造与失败保护测试**

  ```ts
  it('把 v1 Base URL 规范为 Chat Completions 地址', () => {
    expect(normalizeChatCompletionsUrl('https://api.example.com/v1/').href)
      .toBe('https://api.example.com/v1/chat/completions');
  });

  it('AI 返回无效 JSON 时保留原草稿', async () => {
    const client = createAiClient(async () => new Response('{"choices":[{"message":{"content":"not-json"}}]}'));
    await expect(client.expandDraft(settings, draft)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(draft.description).toBe('原始描述');
  });
  ```

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm test tests/unit/ai-client.test.ts tests/unit/ai-validation.test.ts`

- [ ] **步骤 3：实现兼容请求和结构化响应验证**

  请求使用 `Authorization: Bearer`、`Content-Type: application/json`、`model`、`temperature` 与 JSON 响应约束提示。响应只接受 `title`、`description`、`warnings`；不得直接写入草稿。

- [ ] **步骤 4：实现事实漂移提示**

  检测 AI 新增的数字、货币金额和“全新、正品、保修、授权、包退”等高风险声明；未出现在来源事实或用户草稿中时写入警告，用户必须显式应用预览。

- [ ] **步骤 5：运行并提交**

  运行：`pnpm test tests/unit/ai-client.test.ts tests/unit/ai-validation.test.ts && pnpm typecheck`

  ```bash
  git add src/ai tests/unit/ai-client.test.ts tests/unit/ai-validation.test.ts
  git commit -m "feat: add openai compatible copy expansion"
  ```

### 任务 6：实现闲鱼登录检测与标签页编排

**文件：**
- 新建：`src/xianyu/login.ts`
- 新建：`src/xianyu/tab-orchestrator.ts`
- 新建：`tests/fixtures/xianyu-logged-out.html`
- 新建：`tests/fixtures/xianyu-publish.html`
- 测试：`tests/unit/xianyu-login.test.ts`
- 测试：`tests/unit/xianyu-tabs.test.ts`

**接口：**
- 产出：`detectLoginState(document, url): 'logged-in' | 'logged-out' | 'unknown'`。
- 产出：`prepareXianyuPublishTab(deps): Promise<XianyuTabResult>`。

- [ ] **步骤 1：写登录状态与标签页优先级失败测试**

  ```ts
  it('登录页明确返回未登录', () => {
    expect(detectLoginState(loggedOutDocument, 'https://www.goofish.com/')).toBe('logged-out');
  });

  it('优先复用当前闲鱼标签页', async () => {
    const result = await prepareXianyuPublishTab(fakeDepsWithActiveXianyuTab());
    expect(result.reusedActiveTab).toBe(true);
    expect(result.createdTab).toBe(false);
  });
  ```

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm test tests/unit/xianyu-login.test.ts tests/unit/xianyu-tabs.test.ts`

- [ ] **步骤 3：实现登录检测与三段优先级**

  顺序固定为当前闲鱼页、已有闲鱼页、新建发布页。登录状态不明确时不得继续填写，返回 `XIANYU_LOGIN_UNKNOWN`，侧边栏提示用户打开页面检查。

- [ ] **步骤 4：运行并提交**

  运行：`pnpm test tests/unit/xianyu-login.test.ts tests/unit/xianyu-tabs.test.ts && pnpm typecheck`

  ```bash
  git add src/xianyu/login.ts src/xianyu/tab-orchestrator.ts tests/fixtures/xianyu-logged-out.html tests/fixtures/xianyu-publish.html tests/unit/xianyu-login.test.ts tests/unit/xianyu-tabs.test.ts
  git commit -m "feat: detect xianyu login and prepare publish tab"
  ```

### 任务 7：实现闲鱼表单填写和图片传递，锁死手动发布边界

**文件：**
- 新建：`src/xianyu/dom.ts`
- 新建：`src/xianyu/fill.ts`
- 新建：`entrypoints/xianyu.content.ts`
- 测试：`tests/unit/xianyu-fill.test.ts`
- 测试：`tests/unit/no-publish-action.test.ts`

**接口：**
- 产出：`fillXianyuDraft(document, payload): FillResult`。
- 产出：`downloadSelectedImages(fetchImpl, images): Promise<ImageDownloadResult>`，分别返回可上传文件与逐图失败原因。
- 产出：消息 `CHECK_XIANYU_LOGIN` 与 `FILL_XIANYU_DRAFT`。
- 禁止产出任何 `PUBLISH`、`CLICK_PUBLISH`、`submitListing` 或等价接口。

- [ ] **步骤 1：先写字段填写与发布门禁失败测试**

  ```ts
  it('填写标题、价格、描述和图片后不触发发布按钮', async () => {
    const publish = document.querySelector<HTMLButtonElement>('[data-testid="publish"]')!;
    let clicked = false;
    publish.addEventListener('click', () => { clicked = true; });
    const result = await fillXianyuDraft(document, validPayload);
    expect(result.filled).toEqual(expect.arrayContaining(['title', 'price', 'description', 'images']));
    expect(clicked).toBe(false);
  });

  it('消息协议不存在最终发布动作', () => {
    expect(runtimeMessageTypes).not.toContain('PUBLISH');
    expect(runtimeMessageTypes).not.toContain('CLICK_PUBLISH');
  });
  ```

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm test tests/unit/xianyu-fill.test.ts tests/unit/no-publish-action.test.ts`

- [ ] **步骤 3：实现可观察字段填写**

  按标签、可访问名称、稳定属性、组件结构、可见文字依次寻找字段。文本与数值字段必须触发 `focus`、原生 setter、`input`、`change`、`blur`。找不到字段时写入 `skipped` 与原因。

- [ ] **步骤 4：实现受控图片上传**

  Background 在用户已授权来源上下载图片，验证 `image/jpeg`、`image/png`、`image/webp` 和单张大小上限，通过消息传入二进制；内容脚本构造 `File` 与 `DataTransfer`，设置文件输入并触发变更事件。

- [ ] **步骤 5：运行发布门禁扫描并提交**

  运行：

  ```bash
  pnpm test tests/unit/xianyu-fill.test.ts tests/unit/no-publish-action.test.ts
  if rg -n "click.*发布|CLICK_PUBLISH|submitListing|publish_item" src entrypoints; then exit 1; fi
  pnpm typecheck
  ```

  ```bash
  git add src/xianyu/dom.ts src/xianyu/fill.ts entrypoints/xianyu.content.ts tests/unit/xianyu-fill.test.ts tests/unit/no-publish-action.test.ts
  git commit -m "feat: fill xianyu draft without publishing"
  ```

### 任务 8：实现 Background 消息编排和 Side Panel 界面

**文件：**
- 新建：`entrypoints/background.ts`
- 新建：`src/background/handlers.ts`
- 新建：`entrypoints/sidepanel/index.html`
- 新建：`entrypoints/sidepanel/main.tsx`
- 新建：`entrypoints/sidepanel/styles.css`
- 新建：`src/sidepanel/App.tsx`
- 新建：`src/sidepanel/state.ts`
- 新建：`src/sidepanel/components/LoginBanner.tsx`
- 新建：`src/sidepanel/components/ProductEditor.tsx`
- 新建：`src/sidepanel/components/ImagePicker.tsx`
- 新建：`src/sidepanel/components/AiSettingsForm.tsx`
- 新建：`src/sidepanel/components/ExpansionPreview.tsx`
- 新建：`src/sidepanel/components/OperationLog.tsx`
- 测试：`tests/unit/sidepanel-state.test.ts`
- 测试：`tests/unit/sidepanel-app.test.tsx`

**接口：**
- 消费：前述领域、解析、AI、标签页与闲鱼填写接口。
- 产出：用户完整工作流、显式权限说明、AI 预览应用、登录提醒和运行记录。

- [ ] **步骤 1：写状态机与关键界面失败测试**

  ```ts
  it('解析成功后进入可编辑状态', () => {
    const state = reduceWorkflow(initialState, { type: 'PARSE_SUCCEEDED', product: parsedProduct });
    expect(state.phase).toBe('editing');
    expect(state.draft.title).toBe(parsedProduct.title);
  });

  it('未登录时显示登录提醒且禁用填表动作', () => {
    render(<App services={servicesWithLoggedOutXianyu} />);
    expect(screen.getByText('需要登录闲鱼')).toBeVisible();
    expect(screen.getByRole('button', { name: '填入闲鱼' })).toBeDisabled();
  });
  ```

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm test tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx`

- [ ] **步骤 3：实现消息路由和取消机制**

  Background 只接受 `RuntimeMessage` 联合类型。每次解析生成操作 ID；较新的解析开始后，旧操作返回结果不得覆盖当前草稿。错误统一转换为中文可操作提示。

- [ ] **步骤 4：实现三页侧边栏与原创视觉**

  页面为“商品整理、AI 配置、运行记录”。顶部展示登录状态；商品页包含 URL、解析、图片选择、字段编辑、AI 扩写、预览应用和填入闲鱼。底部固定显示“最终发布需在闲鱼页面手动完成”。使用浅灰、白色、深色文字和克制黄色强调，不复制参考截图的品牌、图标或导航名称。

- [ ] **步骤 5：实现 Chrome 左右侧提示**

  当 `chrome.sidePanel.getLayout()` 可用并返回左侧时，显示浏览器控制侧栏位置的说明；不声称扩展可以强制右侧。

- [ ] **步骤 6：运行组件测试、视觉静态检查并提交**

  运行：

  ```bash
  pnpm test tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
  if rg -n "[0-9]px" entrypoints src docs; then exit 1; fi
  if rg --pcre2 -n "[\x{1F300}-\x{1FAFF}]" entrypoints src docs; then exit 1; fi
  pnpm typecheck
  ```

  ```bash
  git add entrypoints/background.ts entrypoints/sidepanel src/background/handlers.ts src/sidepanel tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
  git commit -m "feat: add xianyu assistant side panel workflow"
  ```

### 任务 9：建立扩展端到端测试、中文 README 和打包验证

**文件：**
- 新建：`tests/e2e/extension.spec.ts`
- 新建：`tests/e2e/fixtures-server.ts`
- 新建：`README.md`
- 新建：`docs/本地安装与验证.md`

**接口：**
- 产出：隔离 Chromium 加载 `.output/chrome-mv3` 的测试夹具。
- 产出：不依赖真实账户或真实发布动作的完整端到端证据。

- [ ] **步骤 1：先写端到端失败用例**

  用本地夹具服务器模拟淘宝、京东、OpenAI 兼容接口、闲鱼未登录页和闲鱼发布页。测试必须覆盖打开 Side Panel、解析商品、显示图片、AI 预览、未登录提示、已登录填表和最终发布按钮未点击。

- [ ] **步骤 2：运行并确认红灯**

  运行：`pnpm build && pnpm test:e2e`

  预期：在浏览器编排或测试夹具尚未接通的位置失败，不能因跳过用例而通过。

- [ ] **步骤 3：补齐隔离浏览器测试支撑**

  Playwright 使用独立临时用户目录加载解压扩展，只访问本地夹具服务器；每次运行清理自己的临时目录，不读取用户日常 Chrome Profile。

- [ ] **步骤 4：编写中文使用文档**

  `README.md` 与 `docs/本地安装与验证.md` 必须说明：功能边界、Chrome 116+、Node/pnpm 要求、`pnpm dev`、`pnpm build`、`pnpm zip`、加载已解压扩展、AI 配置、淘宝/京东限制、权限用途、API Key 本地存储限制、登录处理、最终手动发布和故障诊断。

- [ ] **步骤 5：运行完整本地门禁并提交**

  运行：`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e && pnpm zip`

  ```bash
  git add tests/e2e README.md docs/本地安装与验证.md
  git commit -m "test: verify extension workflow and packaging"
  ```

### 任务 10：最终安全审计、私有 GitHub 发布与 GitHub Desktop 接入

**文件：**
- 检查：全部源文件、配置、文档和 Git 历史。

**接口：**
- 产出：私有仓库 `https://github.com/yanquankun/xianyu-assistant`。
- 产出：GitHub Desktop 中可见的本地仓库。

- [ ] **步骤 1：运行秘密和权限扫描**

  运行：

  ```bash
  rg -n "sk-[A-Za-z0-9]|Authorization: Bearer [A-Za-z0-9]|<all_urls>|cookies|debugger|history" . --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/**'
  git status --short
  git diff --check
  ```

  预期：无真实密钥；Manifest 与生产代码不包含禁止权限；工作区无未提交改动。

- [ ] **步骤 2：重新运行所有验收命令**

  运行：`pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e && pnpm zip`

  预期：每条命令退出码为 0，测试没有跳过核心流程。

- [ ] **步骤 3：核对 main 分支和提交历史**

  运行：`git branch --show-current && git log --oneline --decorate -12 && git status --short`

  预期：分支为 `main`，提交历史可追踪，工作区干净。

- [ ] **步骤 4：创建并推送私有仓库**

  先读取确认远程不存在：

  ```bash
  gh repo view yanquankun/xianyu-assistant --json name,visibility,url
  ```

  若返回仓库不存在，执行：

  ```bash
  gh repo create yanquankun/xianyu-assistant --private --source=. --remote=origin --push
  ```

  若仓库已经存在且确认归属为 `yanquankun`，只添加或校正 `origin` 后推送 `main`，不覆盖未知远程历史。

- [ ] **步骤 5：验证远程私有权限与提交一致**

  运行：

  ```bash
  gh repo view yanquankun/xianyu-assistant --json name,visibility,url,defaultBranchRef
  git rev-parse HEAD
  git ls-remote origin refs/heads/main
  ```

  预期：`visibility` 为 `PRIVATE`，默认分支为 `main`，本地与远程提交哈希一致。

- [ ] **步骤 6：添加到 GitHub Desktop**

  使用已安装的 GitHub Desktop 打开 `/Users/mint/Developer/mint_projects/xianyu-assistant`，确认仓库名称、`main` 分支和远程地址正确。此操作不安装 Chrome 扩展，也不访问用户闲鱼账户。

- [ ] **步骤 7：交付结果**

  报告本地路径、私有仓库 URL、最终提交哈希、构建产物目录、ZIP 文件路径、测试数量和所有未执行的真实闲鱼验证。不得把模拟页面验证写成真实闲鱼页面已验证。
