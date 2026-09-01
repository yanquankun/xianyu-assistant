import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProductImage } from '../../src/domain/product';
import { MediaPicker } from '../../src/sidepanel/components/MediaPicker';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const remoteImage: ProductImage = {
  id: 'remote-image',
  location: {
    kind: 'remote',
    url: 'https://img.example.com/1.png',
    extractedBy: 'semantic-dom'
  },
  loadStatus: 'loaded'
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MediaPicker', () => {
  it('上传图片期间只禁用图片入口', () => {
    render(
      <MediaPicker
        images={[]}
        videos={[]}
        isUploadingImages
        isUploadingVideos={false}
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '上传中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上传视频' })).toBeEnabled();
    expect(screen.getByLabelText('上传商品图片')).toBeDisabled();
    expect(screen.getByLabelText('上传商品视频')).toBeEnabled();
  });

  it('上传视频期间只禁用视频入口', () => {
    render(
      <MediaPicker
        images={[]}
        videos={[]}
        isUploadingImages={false}
        isUploadingVideos
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '上传图片' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '上传中…' })).toBeDisabled();
    expect(screen.getByLabelText('上传商品图片')).toBeEnabled();
    expect(screen.getByLabelText('上传商品视频')).toBeDisabled();
  });

  it('不显示图片选中态并按全部媒体计数', () => {
    render(
      <MediaPicker
        images={[remoteImage]}
        videos={[]}
        isUploadingImages={false}
        isUploadingVideos={false}
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(screen.getByText('媒体 1/9')).toBeVisible();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('视频文件选择器允许一次选择多个文件', () => {
    render(
      <MediaPicker
        images={[]}
        videos={[]}
        isUploadingImages={false}
        isUploadingVideos={false}
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(screen.getByLabelText('上传商品视频')).toHaveAttribute('multiple');
  });

  it('将本地上传图片显示为缩略图', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-thumbnail');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'local.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        resolveLocalAsset={() =>
          Promise.resolve({
            assetId: 'asset-1',
            kind: 'image',
            fileName: 'local.png',
            mimeType: 'image/png',
            byteLength: 5,
            createdAt: '2026-08-31T13:00:00.000Z',
            blob: new Blob(['local'], { type: 'image/png' })
          })
        }
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(await screen.findByRole('img', { name: '商品图片 1' })).toHaveAttribute(
      'src',
      'blob:local-thumbnail'
    );
  });

  it('组件卸载时释放本地缩略图对象 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-thumbnail');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const view = render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'local.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        resolveLocalAsset={() =>
          Promise.resolve({
            assetId: 'asset-1',
            kind: 'image',
            fileName: 'local.png',
            mimeType: 'image/png',
            byteLength: 5,
            createdAt: '2026-08-31T13:00:00.000Z',
            blob: new Blob(['local'], { type: 'image/png' })
          })
        }
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    await screen.findByRole('img', { name: '商品图片 1' });
    view.unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-thumbnail');
  });

  it('父组件重新渲染时复用本地缩略图对象 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-thumbnail');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const image: ProductImage = {
      id: 'local-image',
      location: {
        kind: 'local',
        assetId: 'asset-1',
        fileName: 'local.png',
        mimeType: 'image/png',
        byteLength: 5
      },
      loadStatus: 'loaded'
    };
    const asset = {
      assetId: 'asset-1',
      kind: 'image' as const,
      fileName: 'local.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T13:00:00.000Z',
      blob: new Blob(['local'], { type: 'image/png' })
    };
    const view = render(
      <MediaPicker
        images={[image]}
        resolveLocalAsset={() => Promise.resolve(asset)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );
    await screen.findByRole('img', { name: '商品图片 1' });

    view.rerender(
      <MediaPicker
        images={[image]}
        resolveLocalAsset={() => Promise.resolve(asset)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('支持批量图片选择且点击缩略图只打开预览', async () => {
    const uploaded: string[][] = [];
    render(
      <MediaPicker
        images={[remoteImage]}
        videos={[]}
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={(files) => {
          uploaded.push(files.map((file) => file.name));
        }}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    const input = screen.getByLabelText('上传商品图片');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
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
    expect(await screen.findByRole('dialog', { name: '媒体预览' })).toBeVisible();
    expect(screen.getByRole('button', { name: '关闭媒体预览' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: '关闭媒体预览' }), { key: 'Tab' });
    expect(screen.getByRole('button', { name: '关闭媒体预览' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: '关闭媒体预览' }), {
      key: 'Tab',
      shiftKey: true
    });
    expect(screen.getByRole('button', { name: '关闭媒体预览' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(screen.getByRole('button', { name: '预览商品图片 1' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));
    const dialog = await screen.findByRole('dialog', { name: '媒体预览' });
    const backdrop = dialog.parentElement;
    if (backdrop === null) {
      throw new Error('未找到媒体预览遮罩');
    }
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(screen.getByRole('button', { name: '预览商品图片 1' })).toHaveFocus();
  });

  it('关闭本地图片预览时释放对象 URL', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:local-thumbnail')
      .mockReturnValueOnce('blob:local-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'local.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        videos={[]}
        resolveLocalAsset={() =>
          Promise.resolve({
            assetId: 'asset-1',
            kind: 'image',
            fileName: 'local.png',
            mimeType: 'image/png',
            byteLength: 5,
            createdAt: '2026-08-31T13:00:00.000Z',
            blob: new Blob(['local'], { type: 'image/png' })
          })
        }
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    await screen.findByRole('img', { name: '商品图片 1' });
    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭媒体预览' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('本地图片读取失败时标记失败且提供可恢复提示', async () => {
    const statuses: string[] = [];
    render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'local.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        resolveLocalAsset={() => Promise.reject(new Error('读取失败'))}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={(_id, status) => statuses.push(status)}
      />
    );

    await screen.findByText('加载失败');
    statuses.length = 0;
    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));

    expect(await screen.findByText('无法读取本地图片，请重试')).toBeVisible();
    expect(statuses).toEqual(['failed']);
    expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull();
  });

  it('缺失本地图片时标记失败且不创建预览', async () => {
    const statuses: string[] = [];
    render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-missing',
              fileName: 'missing.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        resolveLocalAsset={() => Promise.resolve(null)}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={(_id, status) => statuses.push(status)}
      />
    );

    await screen.findByText('加载失败');
    statuses.length = 0;
    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));

    expect(await screen.findByText('无法读取本地图片，请重试')).toBeVisible();
    expect(statuses).toEqual(['failed']);
    expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull();
  });

  it('读取中的本地图片被删除后不会重新打开预览或创建 URL', async () => {
    const asset = createDeferred<{
      assetId: string;
      kind: 'image';
      fileName: string;
      mimeType: string;
      byteLength: number;
      createdAt: string;
      blob: Blob;
    } | null>();
    const createObjectURL = vi.fn(() => 'blob:deleted-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const view = render(
      <MediaPicker
        images={[
          {
            id: 'local-image',
            location: {
              kind: 'local',
              assetId: 'asset-1',
              fileName: 'local.png',
              mimeType: 'image/png',
              byteLength: 5
            },
            loadStatus: 'loaded'
          }
        ]}
        resolveLocalAsset={() => asset.promise}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));
    fireEvent.click(screen.getByRole('button', { name: '删除商品图片 1' }));
    view.rerender(
      <MediaPicker
        images={[]}
        resolveLocalAsset={() => asset.promise}
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );
    asset.resolve({
      assetId: 'asset-1',
      kind: 'image',
      fileName: 'local.png',
      mimeType: 'image/png',
      byteLength: 5,
      createdAt: '2026-08-31T13:00:00.000Z',
      blob: new Blob(['local'], { type: 'image/png' })
    });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('将视频显示为带播放按钮的缩略图', async () => {
    const createObjectURL = vi.fn(() => 'blob:video-thumbnail');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    render(
      <MediaPicker
        images={[]}
        videos={[
          {
            id: 'local-video',
            assetId: 'asset-video',
            fileName: 'demo.mp4',
            mimeType: 'video/mp4',
            byteLength: 5
          }
        ]}
        resolveLocalAsset={() =>
          Promise.resolve({
            assetId: 'asset-video',
            kind: 'video',
            fileName: 'demo.mp4',
            mimeType: 'video/mp4',
            byteLength: 5,
            createdAt: '2026-09-01T10:00:00.000Z',
            blob: new Blob(['video'], { type: 'video/mp4' })
          })
        }
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(await screen.findByLabelText('商品视频 1 封面')).toHaveAttribute(
      'src',
      'blob:video-thumbnail'
    );
    const playButton = screen.getByRole('button', { name: '播放商品视频 1' });
    expect(playButton).toBeVisible();
    fireEvent.click(playButton);
    expect(await screen.findByRole('dialog', { name: '媒体预览' })).toBeVisible();
  });

  it('视频预览将原生 controls 纳入 Tab 焦点循环并恢复触发元素焦点', async () => {
    const createObjectURL = vi.fn(() => 'blob:video-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    render(
      <MediaPicker
        images={[]}
        videos={[
          {
            id: 'local-video',
            assetId: 'asset-video',
            fileName: 'demo.mp4',
            mimeType: 'video/mp4',
            byteLength: 5
          }
        ]}
        resolveLocalAsset={() =>
          Promise.resolve({
            assetId: 'asset-video',
            kind: 'video',
            fileName: 'demo.mp4',
            mimeType: 'video/mp4',
            byteLength: 5,
            createdAt: '2026-08-31T13:00:00.000Z',
            blob: new Blob(['video'], { type: 'video/mp4' })
          })
        }
        onUploadImages={() => undefined}
        onUploadVideos={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    const trigger = screen.getByRole('button', { name: '播放商品视频 1' });
    fireEvent.click(trigger);
    const video = await screen.findByLabelText('商品视频 1');
    const closeButton = screen.getByRole('button', { name: '关闭媒体预览' });
    expect(closeButton).toHaveFocus();

    video.focus();
    fireEvent.keyDown(video, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(video).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '媒体预览' });
    const backdrop = dialog.parentElement;
    if (backdrop === null) {
      throw new Error('未找到媒体预览遮罩');
    }
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: '关闭媒体预览' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '媒体预览' })).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
