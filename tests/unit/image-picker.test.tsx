import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ImagePicker } from '../../src/sidepanel/components/ImagePicker';

describe('ImagePicker', () => {
  it('图片加载成功或失败时回传状态，失败图片不能继续选择', () => {
    const states: string[] = [];
    const { rerender } = render(
      <ImagePicker
        images={[
          {
            id: 'image-1',
            location: {
              kind: 'remote',
              url: 'https://img.example.com/1.png',
              extractedBy: 'open-graph'
            },
            selected: true,
            loadStatus: 'idle'
          }
        ]}
        onToggle={() => undefined}
        onLoadStatus={(_id, status) => states.push(status)}
      />
    );

    fireEvent.load(screen.getByRole('img', { name: '商品图片 1' }));
    fireEvent.error(screen.getByRole('img', { name: '商品图片 1' }));
    expect(states).toEqual(['loaded', 'failed']);

    rerender(
      <ImagePicker
        images={[
          {
            id: 'image-1',
            location: {
              kind: 'remote',
              url: 'https://img.example.com/1.png',
              extractedBy: 'open-graph'
            },
            selected: false,
            loadStatus: 'failed'
          }
        ]}
        onToggle={() => undefined}
        onLoadStatus={() => undefined}
      />
    );
    expect(screen.getByRole('checkbox', { name: '选择商品图片 1' })).toBeDisabled();
    expect(screen.getByText('加载失败')).toBeVisible();
  });

  it('已选择 9 张图片时禁用其余图片并说明上限', () => {
    render(
      <ImagePicker
        images={Array.from({ length: 10 }, (_, index) => ({
          id: `image-${String(index + 1)}`,
          location: {
            kind: 'remote' as const,
            url: `https://img.example.com/${String(index + 1)}.png`,
            extractedBy: 'dom' as const
          },
          selected: index < 9,
          loadStatus: 'loaded' as const
        }))}
        onToggle={() => undefined}
        onLoadStatus={() => undefined}
      />
    );

    expect(screen.getByRole('checkbox', { name: '选择商品图片 10' })).toBeDisabled();
    expect(screen.getByText('已达 9 张图片上限')).toBeVisible();
  });
});
