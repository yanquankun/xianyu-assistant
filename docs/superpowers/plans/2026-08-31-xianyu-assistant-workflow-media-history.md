# 闲鱼上架助手交互、媒体与运行记录增强实施计划

> **面向智能代理执行者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务逐项实施。本计划使用复选框跟踪步骤。

**目标：** 在保持用户手动最终发布和现有 CRX 交付能力的前提下，实现 AI 扩写直接回填、本地图片与视频、登录刷新、草稿返回初始态及可展开运行记录。

**架构：** 以可迁移的 ProductDraft 媒体引用为核心，小体积元数据留在 chrome.storage.local，Blob 存入扩展域 IndexedDB；侧边栏只调用强类型服务，后台协调权限、日志和闲鱼标签页，内容脚本只负责可验证的 DOM 填写。视频通过绑定目标标签页的短期分块会话传给闲鱼内容脚本，所有路径继续停在用户手动发布之前。

**技术栈：** WXT 0.21、Manifest V3、React 19、TypeScript 6 严格模式、Vitest 4、Testing Library、Playwright、IndexedDB。

**规格：** docs/superpowers/specs/2026-08-31-xianyu-assistant-workflow-media-history-design.md

## 全局约束

- 直接在 main 分支实施，不创建工作树。
- 现有 entrypoints/sidepanel/styles.css 有用户未提交改动；实施前后都要保留，不得格式化、覆盖、暂存或提交该差异。
- 新界面样式写入新文件 entrypoints/sidepanel/enhancements.css，并在 main.tsx 中后置导入。
- 仅支持 Chrome 116 及以上版本，继续使用 Manifest V3 和 Chrome Side Panel。
- 不增加运行时框架依赖；允许增加 fake-indexeddb 作为单元测试专用开发依赖。
- TypeScript 保持 strict，不使用 any，不忽略类型错误。
- 界面、错误信息、README 和验证文档全部使用中文，代码与文档不使用 Emoji。
- 图片支持 JPEG、PNG、WebP；最多选择 9 张，单张不超过 10 MB，填表图片总量不超过 20 MB。
- 视频支持 1 个 MP4 或 MOV，最大 100 MB；无法识别闲鱼视频控件时返回跳过项，不回滚已填写文本和图片。
- API Key、Cookie、Authorization、媒体二进制、对象 URL 和本地绝对路径不得进入运行记录。
- 所有自动化路径不得查找、点击或触发闲鱼最终发布按钮。
- 每个任务先写失败测试，再写最小实现；每次提交只暂存任务列出的文件。

---

### 任务 1：升级草稿媒体模型并兼容旧草稿

**文件：**

- 修改：src/domain/product.ts
- 修改：src/domain/messages.ts
- 修改：src/parsers/merge.ts
- 修改：src/sidepanel/state.ts
- 修改：src/storage/local-store.ts
- 修改：src/sidepanel/services.ts
- 修改：src/background/handlers.ts
- 修改：src/xianyu/fill.ts
- 修改：src/sidepanel/components/ImagePicker.tsx
- 修改：wxt.config.ts
- 修改：tests/unit/messages.test.ts
- 修改：tests/unit/parsers.test.ts
- 修改：tests/unit/sidepanel-state.test.ts
- 修改：tests/unit/sidepanel-app.test.tsx
- 修改：tests/unit/image-picker.test.tsx
- 修改：tests/unit/xianyu-fill.test.ts
- 修改：tests/unit/storage.test.ts
- 修改：tests/unit/permissions.test.ts

**接口：**

- 产出：ProductImageLocation、ProductVideo、getRemoteImageUrl、getLocalAssetIds。
- 产出：parseStoredProductDraft(value: unknown): StoredDraftParseResult | null 返回新草稿及迁移标识。
- 产出：LocalStore.clearDraft() 和 StorageAreaLike.remove(keys)。
- 后续任务只使用 location.kind 判别远程与本地图片，不再直接访问 image.url。

- [ ] **步骤 1：先写新媒体结构、旧草稿迁移和清除草稿的失败测试**

在 tests/unit/messages.test.ts 增加严格新结构和旧结构迁移用例：

```ts
it('把旧版远程图片迁移为可判别位置结构', () => {
  const result = parseStoredProductDraft({
    ...draft,
    images: [
      {
        id: 'legacy-image',
        url: 'https://img.example.com/a.jpg',
        source: 'dom',
        selected: true,
        loadStatus: 'loaded'
      }
    ]
  });

  expect(result).toEqual({
    migrated: true,
    draft: expect.objectContaining({
      images: [
        expect.objectContaining({
          id: 'legacy-image',
          location: {
            kind: 'remote',
            url: 'https://img.example.com/a.jpg',
            extractedBy: 'dom'
          }
        })
      ]
    })
  });
});

it('拒绝同时缺少远程地址和本地资源标识的图片', () => {
  expect(
    isProductDraft({
      ...draft,
      images: [{ id: 'bad', location: { kind: 'local' }, selected: true, loadStatus: 'loaded' }]
    })
  ).toBe(false);
});
```

在 tests/unit/storage.test.ts 为内存存储补充 remove，并断言 clearDraft 真正删除键：

```ts
remove(keys: string | string[]): Promise<void> {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    delete this.data[key];
  }
  return Promise.resolve();
}

it('清除草稿后不会再次恢复', async () => {
  const area = new MemoryStorageArea();
  const store = createLocalStore(area);
  await store.saveDraft(draft);

  await store.clearDraft();

  await expect(store.getDraft()).resolves.toBeNull();
  expect(area.data.productDraft).toBeUndefined();
});
```

在 tests/unit/parsers.test.ts 把图片断言改为 location.url。把 sidepanel-state、sidepanel-app、image-picker 和 xianyu-fill 夹具中的旧图片对象统一改成 location 结构。

在 wxt.config.ts 导出 REQUIRED_PERMISSIONS 常量，tests/unit/permissions.test.ts 直接断言它包含 unlimitedStorage 且不包含 cookies、debugger、history：

```ts
expect(REQUIRED_PERMISSIONS).toContain('unlimitedStorage');
expect(REQUIRED_PERMISSIONS).not.toEqual(
  expect.arrayContaining(['cookies', 'debugger', 'history'])
);
```

- [ ] **步骤 2：运行定向测试并确认因类型和接口缺失而失败**

运行：

```bash
pnpm vitest run tests/unit/messages.test.ts tests/unit/storage.test.ts tests/unit/parsers.test.ts tests/unit/sidepanel-state.test.ts tests/unit/permissions.test.ts
```

预期：parseStoredProductDraft、location、clearDraft 或 unlimitedStorage 相关断言失败；失败点必须来自本任务尚未实现的接口。

- [ ] **步骤 3：实现可判别媒体模型与安全迁移**

在 src/domain/product.ts 定义：

```ts
export type RemoteImageExtractionSource = 'json-ld' | 'open-graph' | 'meta' | 'dom';

export type ProductImageLocation =
  | {
      kind: 'remote';
      url: string;
      extractedBy: RemoteImageExtractionSource;
    }
  | {
      kind: 'local';
      assetId: string;
      fileName: string;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      byteLength: number;
    };

export interface ProductImage {
  id: string;
  location: ProductImageLocation;
  selected: boolean;
  loadStatus: ImageLoadStatus;
}

export interface ProductVideo {
  id: string;
  assetId: string;
  fileName: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  byteLength: number;
}

export interface StoredDraftParseResult {
  draft: ProductDraft;
  migrated: boolean;
}
```

给 ProductDraft 增加 video?: ProductVideo，并新增纯函数：

```ts
export function getRemoteImageUrl(image: ProductImage): string | null {
  return image.location.kind === 'remote' ? image.location.url : null;
}

export function getLocalAssetIds(draft: ProductDraft): string[] {
  const imageIds = draft.images.flatMap((image) =>
    image.location.kind === 'local' ? [image.location.assetId] : []
  );
  return draft.video === undefined ? imageIds : [...imageIds, draft.video.assetId];
}
```

在 src/domain/messages.ts 保留 isProductDraft 作为运行时新结构的严格校验；新增 parseStoredProductDraft，仅允许 chrome.storage.local 读取时迁移旧版 {url, source} 远程图片。损坏单图被移除，并向 warnings 追加“已移除无法恢复的旧版图片”。

DRAFT_RESTORED 只把 remote 图片恢复为 idle，local 图片保留已持久化状态，任务 3 再通过 MediaStore 校验 Blob 是否存在：

```ts
images: action.draft.images.map((image) => ({
  ...image,
  loadStatus: image.location.kind === 'remote' ? 'idle' : image.loadStatus
}));
```

- [ ] **步骤 4：更新生产者、消费者和持久化边界**

在 src/parsers/merge.ts 生成：

```ts
images.push({
  id: 'image-' + String(images.length + 1),
  location: {
    kind: 'remote',
    url,
    extractedBy: candidate.source
  },
  selected: images.length < 9,
  loadStatus: 'idle'
});
```

解析器仍可返回最多 20 个候选，但只默认选中前 9 个。

在 LocalStore 中增加：

```ts
export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface LocalStore {
  clearDraft(): Promise<void>;
}
```

getDraft 使用 parseStoredProductDraft；发现 migrated 为 true 时立即保存新结构。sidepanel 和 background 的 storageArea 包装器都转发 browser.storage.local.remove。wxt.config.ts 的 permissions 使用导出的 REQUIRED_PERMISSIONS，并增加 unlimitedStorage。

为保证本任务结束时可以独立 typecheck：

- services.sourceOrigins 只从 location.kind === 'remote' 的已选图片读取 URL。
- xianyu/fill.ts 的远程下载函数用 getRemoteImageUrl；遇到 location.kind === 'local' 时先返回“本地图片将在媒体填充阶段处理”，任务 8 再接入 MediaStore。
- ImagePicker 用 getRemoteImageUrl 渲染当前远程图片；本地图片界面由任务 3 的 MediaPicker 完整替换。

- [ ] **步骤 5：运行定向测试、类型检查并确认通过**

运行：

```bash
pnpm vitest run tests/unit/messages.test.ts tests/unit/storage.test.ts tests/unit/parsers.test.ts tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/image-picker.test.tsx tests/unit/xianyu-fill.test.ts tests/unit/permissions.test.ts
pnpm typecheck
```

预期：全部通过，旧草稿可迁移，新运行时消息拒绝损坏媒体结构。

- [ ] **步骤 6：提交任务 1**

```bash
git add src/domain/product.ts src/domain/messages.ts src/parsers/merge.ts src/sidepanel/state.ts src/storage/local-store.ts src/sidepanel/services.ts src/background/handlers.ts src/xianyu/fill.ts src/sidepanel/components/ImagePicker.tsx wxt.config.ts tests/unit/messages.test.ts tests/unit/parsers.test.ts tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/image-picker.test.tsx tests/unit/xianyu-fill.test.ts tests/unit/storage.test.ts tests/unit/permissions.test.ts
git commit -m "feat: 升级草稿媒体模型"
```

---

### 任务 2：实现本地媒体校验与 IndexedDB 仓储

**文件：**

- 创建：src/media/validation.ts
- 创建：src/storage/media-store.ts
- 创建：tests/unit/media-validation.test.ts
- 创建：tests/unit/media-store.test.ts
- 修改：package.json
- 修改：pnpm-lock.yaml

**接口：**

- 产出：validateImageBatch(files, remainingSlots) 和 validateVideo(file)。
- 产出：MediaStore.save、get、delete、deleteMany、cleanupExcept。
- 产出：StoredMediaAsset 与 StoredMediaMetadata。
- 任务 3 和任务 8 通过 MediaStore 访问 Blob，不直接使用 IndexedDB API。

- [ ] **步骤 1：添加 IndexedDB 测试实现并写失败测试**

运行：

```bash
pnpm add -D fake-indexeddb
```

在 tests/unit/media-validation.test.ts 覆盖部分成功、剩余名额、MIME 和大小：

```ts
it('批量选择时保留合法图片并逐项返回拒绝原因', () => {
  const result = validateImageBatch(
    [
      new File(['ok'], 'ok.png', { type: 'image/png' }),
      new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })
    ],
    1
  );

  expect(result.accepted.map((file) => file.name)).toEqual(['ok.png']);
  expect(result.rejected).toEqual([{ fileName: 'bad.svg', reason: '仅支持 JPEG、PNG、WebP 图片' }]);
});

it('拒绝超过 100 MB 的视频并保留可用的 MP4', () => {
  expect(validateVideo(new File(['ok'], 'demo.mp4', { type: 'video/mp4' })).ok).toBe(true);
  const oversized = new File(['x'], 'large.mov', { type: 'video/quicktime' });
  Object.defineProperty(oversized, 'size', { value: 100 * 1024 * 1024 + 1 });
  expect(validateVideo(oversized)).toEqual({ ok: false, reason: '视频不能超过 100 MB' });
});
```

在 tests/unit/media-store.test.ts 使用 IDBFactory 验证保存、读取、删除和孤立清理：

```ts
import { IDBFactory } from 'fake-indexeddb';

it('保存 Blob 后可按 assetId 读取并删除', async () => {
  const store = createMediaStore(new IDBFactory(), () => 'asset-1');
  const metadata = await store.save(new File(['image'], 'a.png', { type: 'image/png' }), 'image');

  await expect(store.get(metadata.assetId)).resolves.toMatchObject({
    assetId: 'asset-1',
    fileName: 'a.png',
    kind: 'image'
  });

  await store.delete(metadata.assetId);
  await expect(store.get(metadata.assetId)).resolves.toBeNull();
});
```

- [ ] **步骤 2：运行新测试并确认模块缺失**

运行：

```bash
pnpm vitest run tests/unit/media-validation.test.ts tests/unit/media-store.test.ts
```

预期：因为 src/media/validation.ts 和 src/storage/media-store.ts 尚不存在而失败。

- [ ] **步骤 3：实现媒体校验常量和部分成功结果**

在 src/media/validation.ts 导出固定边界：

```ts
export const MAX_SELECTED_IMAGES = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface RejectedMediaFile {
  fileName: string;
  reason: string;
}

export interface ImageBatchValidation {
  accepted: File[];
  rejected: RejectedMediaFile[];
}
```

validateImageBatch 按输入顺序处理，超过 remainingSlots、MIME 不允许或单图过大时只拒绝对应文件。validateVideo 接受 video/mp4、video/quicktime；当浏览器没有 MIME 时，仅允许 .mp4 或 .mov 扩展名并规范化 MIME。

- [ ] **步骤 4：实现扩展域 IndexedDB 仓储**

在 src/storage/media-store.ts 使用数据库 xianyu-assistant-media、对象仓库 assets 和 keyPath assetId：

```ts
export type StoredMediaKind = 'image' | 'video';

export interface StoredMediaMetadata {
  assetId: string;
  kind: StoredMediaKind;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
}

export interface StoredMediaAsset extends StoredMediaMetadata {
  blob: Blob;
}

export interface MediaStore {
  save(file: File, kind: StoredMediaKind): Promise<StoredMediaMetadata>;
  get(assetId: string): Promise<StoredMediaAsset | null>;
  delete(assetId: string): Promise<void>;
  deleteMany(assetIds: readonly string[]): Promise<void>;
  cleanupExcept(referencedAssetIds: ReadonlySet<string>): Promise<void>;
}

export function createMediaStore(
  factory: IDBFactory = indexedDB,
  createId: () => string = () => crypto.randomUUID()
): MediaStore;
```

所有 IDBRequest 和 IDBTransaction 都转成会拒绝的 Promise；事务 abort 或 error 必须返回“本地媒体保存失败”或“本地媒体读取失败”，不能静默成功。

- [ ] **步骤 5：运行媒体测试和类型检查**

运行：

```bash
pnpm vitest run tests/unit/media-validation.test.ts tests/unit/media-store.test.ts
pnpm typecheck
```

预期：全部通过；package.json 只新增 fake-indexeddb 开发依赖。

- [ ] **步骤 6：提交任务 2**

```bash
git add src/media/validation.ts src/storage/media-store.ts tests/unit/media-validation.test.ts tests/unit/media-store.test.ts package.json pnpm-lock.yaml
git commit -m "feat: 持久化本地商品媒体"
```

---

### 任务 3：实现图片批量上传、视频选择与顶层预览

**文件：**

- 创建：src/sidepanel/components/MediaPicker.tsx
- 创建：src/sidepanel/components/MediaPreviewDialog.tsx
- 创建：tests/unit/media-picker.test.tsx
- 删除：src/sidepanel/components/ImagePicker.tsx
- 删除：tests/unit/image-picker.test.tsx
- 修改：src/sidepanel/components/ProductEditor.tsx
- 修改：src/sidepanel/App.tsx
- 修改：src/sidepanel/state.ts
- 修改：src/sidepanel/services.ts
- 创建：entrypoints/sidepanel/enhancements.css
- 修改：entrypoints/sidepanel/main.tsx

**接口：**

- SidePanelServices 新增 saveMedia、loadMedia、deleteMedia、cleanupMedia。
- WorkflowAction 新增 LOCAL_IMAGES_ADDED、IMAGE_REMOVED、VIDEO_REPLACED、VIDEO_REMOVED。
- MediaPicker 负责文件输入、缩略图、独立选择/删除操作和预览对话框；App 负责持久化与状态更新。

MediaPicker 使用以下精确属性：

```ts
interface MediaPickerProps {
  images: readonly ProductImage[];
  video?: ProductVideo;
  selectedCount: number;
  resolveLocalAsset: (assetId: string) => Promise<StoredMediaAsset | null>;
  onUploadImages: (files: readonly File[]) => void;
  onUploadVideo: (file: File) => void;
  onToggle: (id: string) => void;
  onRemoveImage: (id: string) => void;
  onRemoveVideo: () => void;
  onLoadStatus: (id: string, status: ImageLoadStatus) => void;
}
```

- [ ] **步骤 1：写 reducer 和媒体组件失败测试**

在 tests/unit/sidepanel-state.test.ts 增加选中数量硬限制：

```ts
it('解析图片与本地图片合计最多选择九张', () => {
  const images = Array.from({ length: 9 }, (_, index) => ({
    id: 'image-' + String(index),
    location: {
      kind: 'remote' as const,
      url: 'https://img.example.com/' + String(index) + '.jpg',
      extractedBy: 'dom' as const
    },
    selected: true,
    loadStatus: 'loaded' as const
  }));
  const state = reduceWorkflow(
    { ...initialWorkflowState, phase: 'editing', draft: { ...draft, images } },
    {
      type: 'LOCAL_IMAGES_ADDED',
      images: [
        {
          id: 'local-10',
          location: {
            kind: 'local',
            assetId: 'asset-10',
            fileName: 'ten.png',
            mimeType: 'image/png',
            byteLength: 3
          },
          selected: true,
          loadStatus: 'loaded'
        }
      ],
      now: '2026-08-31T13:00:00.000Z'
    }
  );

  expect(state.draft?.images).toHaveLength(9);
  expect(state.statusMessage).toContain('最多选择 9 张');
});
```

在 tests/unit/media-picker.test.tsx 覆盖 multiple、accept、上传回调、独立预览和 URL 释放：

```tsx
it('支持批量图片选择且点击缩略图只打开预览', async () => {
  const uploaded: string[][] = [];
  render(
    <MediaPicker
      images={[remoteImage]}
      video={undefined}
      selectedCount={1}
      resolveLocalAsset={() => Promise.resolve(null)}
      onUploadImages={(files) => {
        uploaded.push(files.map((file) => file.name));
      }}
      onUploadVideo={() => undefined}
      onToggle={() => undefined}
      onRemoveImage={() => undefined}
      onRemoveVideo={() => undefined}
      onLoadStatus={() => undefined}
    />
  );

  const input = screen.getByLabelText('上传商品图片');
  expect(input).toHaveAttribute('multiple');
  fireEvent.change(input, {
    target: {
      files: [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['b'], 'b.jpg', { type: 'image/jpeg' })
      ]
    }
  });
  expect(uploaded).toEqual([['a.png', 'b.jpg']]);

  fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));
  expect(screen.getByRole('dialog', { name: '媒体预览' })).toBeVisible();
});
```

- [ ] **步骤 2：运行定向测试并确认新动作和组件缺失**

运行：

```bash
pnpm vitest run tests/unit/sidepanel-state.test.ts tests/unit/media-picker.test.tsx tests/unit/sidepanel-app.test.tsx
```

预期：LOCAL_IMAGES_ADDED、MediaPicker 和新服务方法相关失败。

- [ ] **步骤 3：实现侧边栏媒体服务和状态动作**

createBrowserSidePanelServices 内创建 createMediaStore(indexedDB)，并暴露：

```ts
saveMedia(file: File, kind: 'image' | 'video'): Promise<StoredMediaMetadata>;
loadMedia(assetId: string): Promise<StoredMediaAsset | null>;
deleteMedia(assetId: string): Promise<void>;
cleanupMedia(referencedAssetIds: readonly string[]): Promise<void>;
```

App 初始化草稿后调用 cleanupMedia(getLocalAssetIds(draft))；没有草稿时传空数组清理孤立媒体。上传图片时先 validateImageBatch，再逐个 await saveMedia，全部保存完成后一次 dispatch LOCAL_IMAGES_ADDED；保存失败的文件不进入草稿。上传视频先 validateVideo 和 saveMedia，成功后 dispatch VIDEO_REPLACED，再删除旧视频 assetId。

- [ ] **步骤 4：实现媒体选择器与预览生命周期**

MediaPicker 使用隐藏文件输入：

```tsx
<input
  aria-label="上传商品图片"
  type="file"
  accept="image/jpeg,image/png,image/webp"
  multiple
  onChange={(event) => {
    const files = Array.from(event.currentTarget.files ?? []);
    onUploadImages(files);
    event.currentTarget.value = '';
  }}
/>
```

视频输入接受 video/mp4,video/quicktime,.mp4,.mov。每个图片卡片具有独立的预览按钮、复选框和删除按钮。MediaPreviewDialog 设置 role="dialog"、aria-modal="true"，监听 Escape；组件对本地 Blob 创建对象 URL，并在媒体改变或卸载时释放。

- [ ] **步骤 5：接入 ProductEditor 和独立增强样式**

ProductEditor 接收媒体回调，不再导入 ImagePicker。新增 entrypoints/sidepanel/enhancements.css，定义 media-toolbar、media-tile-actions、media-preview-backdrop、media-preview-dialog、video-card 和 spinner；所有尺寸使用 rem、em、百分比、vh 或 vw。

entrypoints/sidepanel/main.tsx 保持原样式导入并新增：

```ts
import './styles.css';
import './enhancements.css';
```

不得修改或暂存 entrypoints/sidepanel/styles.css。

- [ ] **步骤 6：运行组件、状态、存储和类型测试**

运行：

```bash
pnpm vitest run tests/unit/media-picker.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/media-store.test.ts tests/unit/media-validation.test.ts
pnpm typecheck
```

预期：批量上传、9 张限制、视频替换、预览关闭和对象 URL 释放全部通过。

- [ ] **步骤 7：提交任务 3**

```bash
git add src/sidepanel/components/MediaPicker.tsx src/sidepanel/components/MediaPreviewDialog.tsx tests/unit/media-picker.test.tsx src/sidepanel/components/ProductEditor.tsx src/sidepanel/App.tsx src/sidepanel/state.ts src/sidepanel/services.ts entrypoints/sidepanel/enhancements.css entrypoints/sidepanel/main.tsx
git add -u src/sidepanel/components/ImagePicker.tsx tests/unit/image-picker.test.tsx
git commit -m "feat: 添加本地图片和视频编辑"
```

---

### 任务 4：把 AI 扩写改为加载后直接写回

**文件：**

- 修改：src/sidepanel/state.ts
- 修改：src/sidepanel/App.tsx
- 删除：src/sidepanel/components/ExpansionPreview.tsx
- 修改：tests/unit/sidepanel-state.test.ts
- 修改：tests/unit/sidepanel-app.test.tsx

**接口：**

- EXPANSION_STARTED 携带 draftId 和 draftUpdatedAt。
- EXPANSION_RECEIVED 携带相同目标、校验后的 ExpansionPreview 和 now。
- EXPANSION_FAILED 恢复 editing 状态并保留原草稿。
- App 不再持有或渲染 expansionPreview。

- [ ] **步骤 1：把旧预览测试改成直接回填和过期响应测试**

```ts
it('AI 结果直接写回标题描述并合并去重警告', () => {
  const started = reduceWorkflow(
    { ...initialWorkflowState, phase: 'editing', draft },
    {
      type: 'EXPANSION_STARTED',
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt
    }
  );
  const result = reduceWorkflow(started, {
    type: 'EXPANSION_RECEIVED',
    draftId: draft.id,
    draftUpdatedAt: draft.updatedAt,
    preview: {
      title: '扩写标题',
      description: '扩写描述',
      warnings: ['信息不足'],
      factWarnings: ['信息不足', '出现新数字']
    },
    now: '2026-08-31T13:10:00.000Z'
  });

  expect(result.draft).toMatchObject({
    title: '扩写标题',
    description: '扩写描述',
    warnings: ['信息不足', '出现新数字']
  });
  expect(result.statusMessage).toBe('AI 文案已写入表单');
});

it('草稿已编辑时丢弃迟到的 AI 结果', () => {
  const changed = { ...draft, title: '用户刚修改', updatedAt: 'newer' };
  const result = reduceWorkflow(
    {
      ...initialWorkflowState,
      phase: 'expanding',
      draft: changed,
      expansionTarget: { draftId: draft.id, draftUpdatedAt: draft.updatedAt }
    },
    {
      type: 'EXPANSION_RECEIVED',
      draftId: draft.id,
      draftUpdatedAt: draft.updatedAt,
      preview: {
        title: '迟到标题',
        description: '迟到描述',
        warnings: [],
        factWarnings: []
      },
      now: '2026-08-31T13:10:00.000Z'
    }
  );
  expect(result.draft?.title).toBe('用户刚修改');
});
```

组件测试使用延迟 Promise，点击后断言按钮文本“AI 扩写中”、disabled 和 aria-busy；resolve 后直接断言标题输入框更新，并断言页面不存在“AI 文案预览”。

- [ ] **步骤 2：运行 AI 定向测试并确认旧行为失败**

运行：

```bash
pnpm vitest run tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
```

预期：旧 reducer 仍保存 preview，组件仍显示确认卡片，因此新断言失败。

- [ ] **步骤 3：重构 AI 状态机与 App 调用**

WorkflowState 增加：

```ts
expansionTarget: {
  draftId: string;
  draftUpdatedAt: string;
} | null;
```

EXPANSION_RECEIVED 只有在当前 draft.id、draft.updatedAt 和 expansionTarget 同时匹配时写回；警告使用 Set 去重。App.expandDraft 在请求前复制 draftId 和 updatedAt，请求结束时带回同一目标。失败 dispatch EXPANSION_FAILED，而不是通用 OPERATION_FAILED。

- [ ] **步骤 4：删除预览组件并实现按钮加载态**

从 App 删除 ExpansionPreview import 和渲染。按钮内容改为：

```tsx
<button
  className="button button--secondary"
  type="button"
  disabled={expansionDisabled}
  aria-busy={state.phase === 'expanding'}
  onClick={() => void expandDraft()}
>
  {state.phase === 'expanding' ? <span className="spinner" aria-hidden="true" /> : null}
  {state.phase === 'expanding' ? 'AI 扩写中' : 'AI 扩写'}
</button>
```

- [ ] **步骤 5：运行测试和类型检查**

```bash
pnpm vitest run tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/ai-validation.test.ts tests/unit/ai-client.test.ts
pnpm typecheck
```

预期：扩写成功直接回填，失败或草稿版本变化时原文保留。

- [ ] **步骤 6：提交任务 4**

```bash
git add src/sidepanel/state.ts src/sidepanel/App.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
git add -u src/sidepanel/components/ExpansionPreview.tsx
git commit -m "feat: AI 扩写完成后直接回填"
```

---

### 任务 5：增加登录状态手动刷新

**文件：**

- 修改：src/xianyu/login.ts
- 创建：src/background/login-check.ts
- 修改：src/background/handlers.ts
- 修改：src/sidepanel/App.tsx
- 修改：src/sidepanel/components/LoginBanner.tsx
- 修改：tests/unit/xianyu-login.test.ts
- 修改：tests/unit/sidepanel-app.test.tsx
- 创建：tests/unit/login-check.test.ts

**接口：**

- 新增 XianyuLoginCheckResult：state 和 message。
- SidePanelServices.checkXianyuLogin 返回 XianyuLoginCheckResult。
- LoginBanner 新增 isRefreshing、message 和 onRefresh。

后台纯编排函数签名：

```ts
interface LoginCheckDependencies {
  listTabs: () => Promise<BrowserTab[]>;
  getActiveTabId: () => Promise<number | undefined>;
  readLoginState: (tabId: number) => Promise<XianyuLoginState>;
}

export function checkXianyuLoginFromTabs(
  dependencies: LoginCheckDependencies
): Promise<XianyuLoginCheckResult>;
```

- [ ] **步骤 1：写登录刷新组件和无标签页结果的失败测试**

```tsx
it('点击刷新时显示加载并立即采用最新登录状态', async () => {
  let resolveCheck: ((value: XianyuLoginCheckResult) => void) | undefined;
  const checks: Promise<XianyuLoginCheckResult>[] = [
    Promise.resolve({ state: 'unknown', message: '尚未确认' }),
    new Promise((resolve) => {
      resolveCheck = resolve;
    })
  ];
  render(
    <App
      services={createServices({
        checkXianyuLogin: () => checks.shift() ?? Promise.reject(new Error('测试调用过多'))
      })}
    />
  );
  await screen.findByText('尚未确认闲鱼登录状态');

  fireEvent.click(screen.getByRole('button', { name: '刷新闲鱼登录状态' }));
  expect(screen.getByRole('button', { name: '刷新闲鱼登录状态' })).toBeDisabled();
  resolveCheck?.({ state: 'logged-in', message: '已重新检查' });

  expect(await screen.findByText('闲鱼已登录')).toBeVisible();
});
```

在 src/background/login-check.ts 提取 checkXianyuLoginFromTabs，并在 tests/unit/login-check.test.ts 断言 tabs 为空时返回：

```ts
{
  state: 'unknown',
  message: '未找到闲鱼页面，请先打开或登录闲鱼'
}
```

- [ ] **步骤 2：运行登录相关测试并确认接口不匹配**

```bash
pnpm vitest run tests/unit/xianyu-login.test.ts tests/unit/login-check.test.ts tests/unit/sidepanel-app.test.tsx
```

预期：XianyuLoginCheckResult 和刷新按钮尚不存在。

- [ ] **步骤 3：实现后台登录检查结果**

在 src/xianyu/login.ts 定义：

```ts
export interface XianyuLoginCheckResult {
  state: XianyuLoginState;
  message: string;
}
```

background.checkXianyuLogin 在无闲鱼标签页、内容脚本异常和三态成功时分别返回明确中文 message。内容脚本内部 CHECK_XIANYU_LOGIN 仍返回原始 XianyuLoginState，避免混淆页面检测和后台编排。

- [ ] **步骤 4：实现 LoginBanner 刷新交互**

LoginBanner 始终渲染刷新按钮；logged-out 时额外显示“打开登录页”。刷新按钮设置 disabled、aria-busy 和 spinner。App 使用 isLoginRefreshing 与 loginMessage；刷新失败时设置 unknown 和错误文本，finally 恢复按钮。

- [ ] **步骤 5：运行定向测试和类型检查**

```bash
pnpm vitest run tests/unit/xianyu-login.test.ts tests/unit/login-check.test.ts tests/unit/sidepanel-app.test.tsx
pnpm typecheck
```

预期：初始化、手动刷新、无闲鱼页和异常回退全部通过。

- [ ] **步骤 6：提交任务 5**

```bash
git add src/xianyu/login.ts src/background/login-check.ts src/background/handlers.ts src/sidepanel/App.tsx src/sidepanel/components/LoginBanner.tsx tests/unit/xianyu-login.test.ts tests/unit/login-check.test.ts tests/unit/sidepanel-app.test.tsx
git commit -m "feat: 支持刷新闲鱼登录状态"
```

---

### 任务 6：显示步骤 02 并安全返回初始状态

**文件：**

- 创建：src/sidepanel/components/ConfirmDialog.tsx
- 创建：tests/unit/confirm-dialog.test.tsx
- 修改：src/sidepanel/components/ProductEditor.tsx
- 修改：src/sidepanel/App.tsx
- 修改：src/sidepanel/state.ts
- 修改：src/sidepanel/services.ts
- 修改：tests/unit/sidepanel-state.test.ts
- 修改：tests/unit/sidepanel-app.test.tsx
- 修改：entrypoints/sidepanel/enhancements.css

**接口：**

- WorkflowAction 新增 WORKFLOW_RESET。
- SidePanelServices 新增 clearDraft(): Promise<void>。
- ProductEditor 新增 onReturnToStart。
- 导出 draftNeedsResetConfirmation(draft) 供状态和组件测试。

- [ ] **步骤 1：写步骤编号、确认和持久化返回失败测试**

```tsx
it('编辑区显示 02 且空白草稿可直接返回双入口', async () => {
  let cleared = 0;
  render(
    <App
      services={createServices({
        clearDraft: () => {
          cleared += 1;
          return Promise.resolve();
        }
      })}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '手动填写' }));

  expect(await screen.findByText('02')).toBeVisible();
  expect(screen.queryByText('低')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));

  await waitFor(() => expect(cleared).toBe(1));
  expect(screen.getByRole('button', { name: '解析商品' })).toBeVisible();
  expect(screen.getByRole('button', { name: '手动填写' })).toBeVisible();
  expect(screen.queryByLabelText('商品标题')).not.toBeInTheDocument();
});

it('非空草稿取消确认后保持编辑内容', async () => {
  render(<App services={createServices()} />);
  fireEvent.click(screen.getByRole('button', { name: '手动填写' }));
  fireEvent.change(await screen.findByLabelText('商品标题'), {
    target: { value: '不能误删的标题' }
  });
  fireEvent.click(screen.getByRole('button', { name: '返回选择方式' }));

  expect(screen.getByRole('dialog', { name: '返回选择方式' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByDisplayValue('不能误删的标题')).toBeVisible();
});
```

Reducer 测试断言 WORKFLOW_RESET 清空 draft、sourceUrl、activeOperationId、错误，但保留 loginState 和 activeView。

- [ ] **步骤 2：运行返回流程测试并确认失败**

```bash
pnpm vitest run tests/unit/confirm-dialog.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx
```

预期：ConfirmDialog、WORKFLOW_RESET、clearDraft 和返回按钮尚不存在。

- [ ] **步骤 3：实现重置状态和存储服务**

SidePanelServices.clearDraft 转发 LocalStore.clearDraft。WORKFLOW_RESET 返回：

```ts
return {
  ...state,
  phase: 'idle',
  activeOperationId: null,
  sourceUrl: '',
  draft: null,
  expansionTarget: null,
  statusMessage: '粘贴淘宝或京东商品链接开始整理',
  errorMessage: null
};
```

所有 PARSE_SUCCEEDED、EXPANSION_RECEIVED 和 FILL_FINISHED 动作必须校验操作标识；重置后的迟到结果直接返回当前 state。

填表动作改为显式操作标识，避免返回后迟到回调污染状态：

```ts
| { type: 'FILL_STARTED'; operationId: string }
| { type: 'FILL_FINISHED'; operationId: string; message: string }
| { type: 'FILL_FAILED'; operationId: string; message: string }
```

- [ ] **步骤 4：实现清除顺序和确认对话框**

App 记录 draft 的本地 assetId，等待 draftSaveQueue 结束，再 await services.clearDraft；成功后 dispatch WORKFLOW_RESET，最后调用 deleteMedia 删除关联 Blob。clearDraft 失败时保留编辑区并显示“草稿清除失败”。

ConfirmDialog 使用 role="dialog"、aria-modal="true"，默认聚焦“取消”，Escape 调用 onCancel。空白手动草稿直接执行清除；draftNeedsResetConfirmation 对标题、描述、价格、原价、非默认发货方式、分类备注、canonicalUrl、图片和视频逐项判断。

- [ ] **步骤 5：把置信度徽标替换为步骤编号**

ProductEditor 删除 CONFIDENCE_LABELS 和 confidence class，标题右侧渲染：

```tsx
<div className="editor-heading-actions">
  <button className="button button--quiet" type="button" onClick={onReturnToStart}>
    返回选择方式
  </button>
  <span className="step-number">02</span>
</div>
```

确认成功后通过 source input ref 聚焦商品链接输入框。

- [ ] **步骤 6：运行定向测试和类型检查**

```bash
pnpm vitest run tests/unit/confirm-dialog.test.tsx tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx tests/unit/storage.test.ts
pnpm typecheck
```

预期：手动和解析草稿均可返回，取消不丢数据，删除失败不伪装成功。

- [ ] **步骤 7：提交任务 6**

```bash
git add src/sidepanel/components/ConfirmDialog.tsx tests/unit/confirm-dialog.test.tsx src/sidepanel/components/ProductEditor.tsx src/sidepanel/App.tsx src/sidepanel/state.ts src/sidepanel/services.ts tests/unit/sidepanel-state.test.ts tests/unit/sidepanel-app.test.tsx entrypoints/sidepanel/enhancements.css
git commit -m "feat: 支持返回商品整理初始状态"
```

---

### 任务 7：保存可脱敏的运行记录快照并展开详情

**文件：**

- 修改：src/storage/operation-log.ts
- 创建：src/background/operation-log-factory.ts
- 修改：src/background/handlers.ts
- 修改：src/sidepanel/services.ts
- 修改：src/sidepanel/components/OperationLog.tsx
- 修改：tests/unit/operation-log.test.ts
- 创建：tests/unit/operation-log-factory.test.ts
- 创建：tests/unit/operation-log-component.test.tsx
- 修改：tests/unit/storage.test.ts
- 修改：entrypoints/sidepanel/enhancements.css

**接口：**

- OperationLogEntry 增加 displayTitle、operationLabel 和 details。
- parseOperationLogEntry 验证旧记录和新记录。
- createSuccessLogEntry 与 createFailureLogEntry 从消息和结果构造不可变快照。

- [ ] **步骤 1：写日志快照、递归脱敏和旧记录兼容失败测试**

```ts
it('AI 成功记录使用生成标题并保存输入链接和生成表单快照', () => {
  const entry = createSuccessLogEntry(
    {
      type: 'EXPAND_DRAFT',
      settings,
      draft: { ...draft, canonicalUrl: 'https://item.jd.com/1.html' }
    },
    {
      title: '当时生成的标题',
      description: '当时生成的描述',
      warnings: ['请核对规格'],
      factWarnings: []
    },
    'log-1',
    '2026-08-31T14:00:00.000Z'
  );

  expect(entry).toMatchObject({
    displayTitle: '当时生成的标题',
    operationLabel: 'AI 扩写',
    details: {
      draft: {
        sourceUrl: 'https://item.jd.com/1.html',
        title: '当时生成的标题',
        description: '当时生成的描述'
      }
    }
  });
});

it('递归清洗详情中的凭据且保留旧版记录', () => {
  const sanitized = sanitizeLogEntry({
    id: 'log-1',
    timestamp: '2026-08-31T14:00:00.000Z',
    stage: 'ai',
    outcome: 'failure',
    message: '失败',
    displayTitle: 'Authorization: Bearer secret',
    details: {
      result: 'Cookie: sid=abc',
      draft: { sourceUrl: 'https://user:pass@example.com/item' }
    }
  });
  expect(JSON.stringify(sanitized)).not.toMatch(/secret|sid=abc|user:pass/u);
  const oldEntry = {
    id: 'old-log',
    timestamp: '2026-08-31T13:00:00.000Z',
    stage: 'parse',
    outcome: 'success',
    message: '旧版解析完成'
  };
  expect(parseOperationLogEntry(oldEntry)).toEqual(oldEntry);
});
```

- [ ] **步骤 2：写可展开组件失败测试**

```tsx
it('外层显示快照标题，点击后显示链接和表单内容', () => {
  render(<OperationLog entries={[detailedEntry]} />);

  expect(screen.getByText('当时生成的标题')).toBeVisible();
  expect(screen.queryByText('当时生成的描述')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /当时生成的标题/u }));

  expect(screen.getByText('当时生成的描述')).toBeVisible();
  expect(screen.getByText('https://item.jd.com/1.html')).toBeVisible();
  expect(screen.getByRole('button', { name: '复制链接' })).toBeVisible();
  expect(screen.getByRole('button', { name: '新窗口打开' })).toBeVisible();
});
```

- [ ] **步骤 3：运行日志测试并确认结构缺失**

```bash
pnpm vitest run tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/storage.test.ts
```

预期：新字段、工厂和展开组件断言失败。

- [ ] **步骤 4：实现日志模型、验证和字段级脱敏**

在 src/storage/operation-log.ts 定义 OperationDraftSnapshot、OperationLogDetails 和可选新字段。sanitizeText 统一限制长度并清理 URL 凭据、Authorization Bearer、apiKey 和 Cookie；sanitizeLogEntry 对所有字符串和 warnings 数组逐项调用。parseOperationLogEntry 接受旧版最小结构，非法 details 字段被丢弃。

LocalStore.getLogs 对数组逐项 parseOperationLogEntry，最多保留最新 100 条，不能直接类型断言。

- [ ] **步骤 5：实现后台日志工厂**

createSuccessLogEntry 按消息类型生成中文 operationLabel：

```ts
const OPERATION_LABELS: Record<RuntimeMessage['type'], string> = {
  PARSE_PRODUCT: '商品解析',
  TEST_AI_CONNECTION: 'AI 连接测试',
  EXPAND_DRAFT: 'AI 扩写',
  CHECK_XIANYU_LOGIN: '登录状态检查',
  FILL_XIANYU_DRAFT: '填入闲鱼',
  OPEN_XIANYU_LOGIN: '打开闲鱼登录页'
};
```

只把必要字段复制到 OperationDraftSnapshot；图片只存 selectedImageCount，视频只存 fileName。失败工厂可读取输入草稿标题，但绝不复制 settings。

background.handleRuntimeMessage 在得到 value 后调用成功工厂；catch 使用失败工厂。日志保存失败通过 console.error 报告，但返回原核心操作结果。

- [ ] **步骤 6：实现列表折叠详情与安全链接动作**

OperationLog 用 expandedId state 保证最多展开一条。记录按钮设置 aria-expanded 和 aria-controls。sourceUrl 仅在 new URL 后协议为 http: 或 https: 时显示打开按钮；复制使用 navigator.clipboard.writeText，失败时显示“复制失败，请手动选择链接”。

- [ ] **步骤 7：运行日志和后台定向测试**

```bash
pnpm vitest run tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/storage.test.ts tests/unit/messages.test.ts
pnpm typecheck
```

预期：新旧日志可读，AI 和填表记录外层显示快照标题，详情不含敏感内容。

- [ ] **步骤 8：提交任务 7**

```bash
git add src/storage/operation-log.ts src/background/operation-log-factory.ts src/background/handlers.ts src/sidepanel/services.ts src/sidepanel/components/OperationLog.tsx tests/unit/operation-log.test.ts tests/unit/operation-log-factory.test.ts tests/unit/operation-log-component.test.tsx tests/unit/storage.test.ts entrypoints/sidepanel/enhancements.css
git commit -m "feat: 展示运行记录快照详情"
```

---

### 任务 8：把本地图片与视频安全填入闲鱼

**文件：**

- 创建：src/xianyu/media-transfer.ts
- 创建：tests/unit/media-transfer.test.ts
- 修改：src/xianyu/fill.ts
- 修改：src/xianyu/dom.ts
- 修改：src/background/handlers.ts
- 修改：entrypoints/xianyu.content.ts
- 修改：tests/fixtures/xianyu-publish.html
- 修改：tests/unit/xianyu-fill.test.ts
- 修改：tests/unit/messages.test.ts
- 修改：tests/unit/no-publish-action.test.ts

**接口：**

- prepareSelectedImages(fetchImpl, mediaStore, images) 同时读取远程图片和本地 IndexedDB 图片。
- XianyuFillPayload 增加 videoTransfer?: MediaTransferDescriptor。
- FillField 增加 video。
- MediaTransferRegistry 创建、读取和释放绑定标签页的短期会话。
- 内容脚本通过名为 xianyu-media-transfer 的 Port 顺序读取视频分块。

- [ ] **步骤 1：写图片来源统一处理和视频控件失败测试**

```ts
it('从本地媒体仓储读取已选择图片', async () => {
  const fetchMock: ImageFetchLike = () => Promise.reject(new Error('本地图片不应触发网络请求'));
  const mediaStoreMock = {
    get: () =>
      Promise.resolve({
        assetId: 'asset-1',
        kind: 'image' as const,
        fileName: 'local.png',
        mimeType: 'image/png',
        byteLength: 3,
        createdAt: '2026-08-31T13:00:00.000Z',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
      })
  };
  const result = await prepareSelectedImages(fetchMock, mediaStoreMock, [
    {
      id: 'local-1',
      location: {
        kind: 'local',
        assetId: 'asset-1',
        fileName: 'local.png',
        mimeType: 'image/png',
        byteLength: 3
      },
      selected: true,
      loadStatus: 'loaded'
    }
  ]);

  expect(result.files).toEqual([
    expect.objectContaining({ id: 'local-1', name: 'local.png', mimeType: 'image/png' })
  ]);
});

it('图片与视频使用不同文件输入框且不触发发布', async () => {
  const document = publishDocument();
  const publish = document.querySelector<HTMLButtonElement>('[data-testid="publish"]');
  if (publish === null) {
    throw new Error('测试夹具需要发布按钮');
  }
  let publishClicked = false;
  publish.addEventListener('click', () => {
    publishClicked = true;
  });
  const videoFile = new File(['video'], 'demo.mp4', { type: 'video/mp4' });
  const result = await fillXianyuDraft(document, validPayload, videoFile);

  expect(document.querySelector<HTMLInputElement>('input[name="images"]')?.files).toHaveLength(1);
  expect(
    document.querySelector<HTMLInputElement>('input[name="video"]')?.files?.item(0)?.name
  ).toBe('demo.mp4');
  expect(result.filled).toContain('video');
  expect(publishClicked).toBe(false);
});
```

fillXianyuDraft 的可测试核心接收已重建的 videoFile；内容脚本负责把 videoTransfer 转成 File 后调用核心函数。

统一图片准备函数签名：

```ts
export function prepareSelectedImages(
  fetchImpl: ImageFetchLike,
  mediaStore: Pick<MediaStore, 'get'>,
  images: readonly ProductImage[]
): Promise<ImageDownloadResult>;
```

- [ ] **步骤 2：写传输会话安全和边界失败测试**

```ts
it('会话只允许绑定标签页按顺序读取并在完成后释放', async () => {
  const registry = createMediaTransferRegistry(
    mediaStore,
    () => 1_000,
    () => 'session-1'
  );
  const descriptor = await registry.create('asset-video', 42);

  await expect(registry.read(descriptor.sessionId, 99, 0)).rejects.toThrow('媒体传输目标不匹配');
  const first = await registry.read(descriptor.sessionId, 42, 0);
  expect(first.offset).toBe(0);
  await registry.release(descriptor.sessionId, 42);
  await expect(registry.read(descriptor.sessionId, 42, 0)).rejects.toThrow('媒体传输会话不存在');
});
```

补充超过分块上限、offset 不连续、过期会话、未知 sessionId 和错误 sender URL 测试。

- [ ] **步骤 3：运行闲鱼媒体测试并确认缺失**

```bash
pnpm vitest run tests/unit/xianyu-fill.test.ts tests/unit/media-transfer.test.ts tests/unit/no-publish-action.test.ts
```

预期：prepareSelectedImages、视频字段、MediaTransferRegistry 尚不存在。

- [ ] **步骤 4：实现图片统一准备与视频 DOM 填写**

src/xianyu/dom.ts 将 findFileInput 拆为：

```ts
export function findImageFileInput(document: Document): HTMLInputElement | null;
export function findVideoFileInput(document: Document): HTMLInputElement | null;
```

视频选择器优先 input[name="video"][type="file"]、accept 包含 video、可访问标签含“视频”；图片选择器排除 accept 包含 video 的控件。

src/xianyu/fill.ts 的 FillField 增加 video，payload 验证继续限制图片 Base64 总量；fillXianyuDraft 接收可选 videoFile。没有视频输入框时加入：

```ts
{ field: 'video', reason: '未找到可靠的视频上传字段，请在闲鱼页面手动上传视频' }
```

- [ ] **步骤 5：实现绑定标签页的分块传输**

src/xianyu/media-transfer.ts 定义：

```ts
export const MEDIA_TRANSFER_CHUNK_BYTES = 512 * 1024;

export interface MediaTransferDescriptor {
  sessionId: string;
  fileName: string;
  mimeType: 'video/mp4' | 'video/quicktime';
  byteLength: number;
  chunkBytes: number;
}

export interface MediaTransferChunk {
  sessionId: string;
  offset: number;
  dataBase64: string;
  done: boolean;
}
```

MediaTransferRegistry 会话包含 assetId、tabId、nextOffset 和 expiresAt；read 只读取 Blob.slice(offset, offset + chunkBytes)，拒绝乱序和跨标签页。background 注册 runtime.onConnect，验证 sender.id、sender.tab.id 和 sender.url 的 www.goofish.com 主机，再响应 READ 与 CLOSE。

注册表工厂签名固定为：

```ts
export function createMediaTransferRegistry(
  mediaStore: Pick<MediaStore, 'get'>,
  now: () => number = () => Date.now(),
  createId: () => string = () => crypto.randomUUID()
): MediaTransferRegistry;
```

内容脚本 receiveMediaFile 打开 xianyu-media-transfer Port，逐块请求、解码为 Uint8Array，完成后构造 File；finally 发送 CLOSE 并 disconnect。单条消息不包含整个 100 MB 视频。

- [ ] **步骤 6：把媒体会话接入填表编排**

background.fillDraft 得到目标 tabId 后：

1. 使用 prepareSelectedImages 处理远程和本地图片。
2. 草稿有 video 时创建绑定该 tabId 的 MediaTransferDescriptor。
3. tabs.sendMessage 只发送图片小载荷与视频 descriptor。
4. 内容脚本重建视频 File 后调用 fillXianyuDraft。
5. background 在 finally 释放会话。

视频仓储缺失或传输失败时返回 video 跳过项；只要至少一张图片成功，文本和图片继续填写。

- [ ] **步骤 7：扩展夹具并验证无最终发布能力**

tests/fixtures/xianyu-publish.html 增加：

```html
<label>图片<input name="images" type="file" accept="image/*" multiple /></label>
<label>视频<input name="video" type="file" accept="video/mp4,video/quicktime" /></label>
```

tests/unit/no-publish-action.test.ts 继续扫描 RuntimeMessage、内容脚本与 src/xianyu 文件，断言不存在最终发布消息或对发布按钮的 click 调用。

- [ ] **步骤 8：运行媒体填表、消息边界和类型测试**

```bash
pnpm vitest run tests/unit/xianyu-fill.test.ts tests/unit/media-transfer.test.ts tests/unit/messages.test.ts tests/unit/no-publish-action.test.ts
pnpm typecheck
```

预期：本地图片、远程图片和视频都经过边界校验；无视频控件时返回跳过；发布按钮始终未触发。

- [ ] **步骤 9：提交任务 8**

```bash
git add src/xianyu/media-transfer.ts tests/unit/media-transfer.test.ts src/xianyu/fill.ts src/xianyu/dom.ts src/background/handlers.ts entrypoints/xianyu.content.ts tests/fixtures/xianyu-publish.html tests/unit/xianyu-fill.test.ts tests/unit/messages.test.ts tests/unit/no-publish-action.test.ts
git commit -m "feat: 填入本地图片和商品视频"
```

---

### 任务 9：完成端到端回归、中文文档和构建验收

**文件：**

- 修改：tests/e2e/extension.spec.ts
- 修改：tests/e2e/fixtures-server.ts
- 修改：README.md
- 修改：docs/本地安装与验证.md
- 修改：tests/unit/build-artifacts.test.ts

**接口：**

- 端到端链路覆盖 AI 直接回填、媒体持久化、登录刷新、返回初始态、日志详情和视频降级。
- 文档描述最终真实行为，不保留 AI 预览旧说明。
- 构建测试继续断言 CRX 文件头和开发目录。

- [ ] **步骤 1：先修改端到端断言以表达新验收行为**

把旧“AI 预览”步骤替换为：

```ts
await panel.getByRole('button', { name: 'AI 扩写' }).click();
await expect(panel.getByRole('button', { name: 'AI 扩写中' })).toBeDisabled();
await expect(panel.getByLabel('商品标题')).toHaveValue('AI 整理后的测试商品');
await expect(panel.getByRole('heading', { name: 'AI 文案预览' })).toHaveCount(0);
```

fixtures-server 的 Chat Completions 响应延迟 150 ms，使加载态断言可观察；测试仍等待最终输入值，不依赖固定页面超时。

新增测试：

- 手动草稿显示步骤 02，取消返回保持数据，确认返回后只剩双入口，重开侧边栏不恢复草稿。
- setInputFiles 一次上传两张图片和一个小 MP4，预览对话框可打开关闭，重开侧边栏后 IndexedDB 媒体仍可读取。
- 点击登录刷新按钮后从 logged-out 更新为 logged-in。
- 完成解析和 AI 后进入运行记录，外层显示“AI 整理后的测试商品”，展开后显示来源 URL、标题和描述。
- 填表后闲鱼图片输入和视频输入均有 File，发布点击计数为 0。
- 通过不含视频 input 的闲鱼夹具执行一次填表，文本和图片仍成功，侧边栏显示“请在闲鱼页面手动上传视频”。

- [ ] **步骤 2：运行端到端测试并记录首个真实失败点**

运行：

```bash
pnpm test:e2e
```

预期：若前八个任务完整实现，测试通过；若失败，只修复首个与新验收相关的真实失败点，不通过放宽断言掩盖问题。

- [ ] **步骤 3：更新中文 README 和本地验证文档**

README.md 更新：

- AI 扩写成功后直接进入表单。
- 图片批量上传、9 张上限、IndexedDB 本地保存和视频限制。
- unlimitedStorage 权限用途。
- 登录刷新按钮。
- 返回选择方式会清除当前草稿及本地媒体。
- 运行记录标题和详情。
- 视频控件不兼容时需要手动上传。

docs/本地安装与验证.md 增加逐项人工验证步骤，并删除“AI 预览/应用”旧说明。继续明确 pnpm build 的 CRX 和 ZIP 产物、pnpm dev 的实时目录以及真实闲鱼最终发布必须由用户点击。

- [ ] **步骤 4：运行格式、静态检查、单元测试和生产构建**

按顺序运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

预期：全部退出码为 0；dist/xianyu-assistant-0.1.0-chrome.crx 文件头为 Cr24，ZIP 文件头为 PK，dev 配置仍指向 dev-dist/xianyu-assistant-unpacked。

- [ ] **步骤 5：检查工作树、敏感信息和发布边界**

运行：

```bash
git diff --check
git status --short
rg -n "Authorization: Bearer|apiKey=|Cookie:" src entrypoints tests README.md docs
rg -n "\\.click\\(|publish|submit|发布" src/xianyu entrypoints/xianyu.content.ts src/domain/messages.ts
xxd -l 16 dist/xianyu-assistant-0.1.0-chrome.crx
```

人工判读：

- 第一条不得报告新增空白错误。
- entrypoints/sidepanel/styles.css 的原有未提交差异仍存在且未进入任何提交。
- 敏感信息搜索只允许脱敏器、测试假值和文档警告。
- 发布边界搜索只允许说明文本、测试断言和“不得发布”约束，不允许最终发布动作。
- CRX 文件头以 4372 3234 开始。

- [ ] **步骤 6：提交任务 9**

```bash
git add tests/e2e/extension.spec.ts tests/e2e/fixtures-server.ts README.md docs/本地安装与验证.md tests/unit/build-artifacts.test.ts
git commit -m "test: 验证媒体与运行记录完整链路"
```

- [ ] **步骤 7：最终提交审计并推送 main**

运行：

```bash
git log --oneline --decorate -12
git diff origin/main...HEAD --stat
git status --short --branch
gh repo view yanquankun/xianyu-assistant --json visibility,defaultBranchRef
git push origin main
```

预期：实现提交全部位于 main；工作树只保留用户原有 entrypoints/sidepanel/styles.css 未提交改动；GitHub 返回 PRIVATE、默认分支 main，随后 origin/main 与本地 HEAD 一致。
