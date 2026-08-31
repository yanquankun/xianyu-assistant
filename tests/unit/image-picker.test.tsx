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
});
