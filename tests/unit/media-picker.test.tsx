import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProductImage } from '../../src/domain/product';
import { MediaPicker } from '../../src/sidepanel/components/MediaPicker';

const remoteImage: ProductImage = {
  id: 'remote-image',
  location: {
    kind: 'remote',
    url: 'https://img.example.com/1.png',
    extractedBy: 'dom'
  },
  selected: true,
  loadStatus: 'loaded'
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MediaPicker', () => {
  it('支持批量图片选择且点击缩略图只打开预览', async () => {
    const uploaded: string[][] = [];
    const toggled: string[] = [];
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
        onToggle={(id) => toggled.push(id)}
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
    expect(toggled).toEqual([]);
  });

  it('关闭本地图片预览时释放对象 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:local-preview');
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
            selected: true,
            loadStatus: 'loaded'
          }
        ]}
        video={undefined}
        selectedCount={1}
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
        onUploadVideo={() => undefined}
        onToggle={() => undefined}
        onRemoveImage={() => undefined}
        onRemoveVideo={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '预览商品图片 1' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '关闭媒体预览' }));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
  });
});
