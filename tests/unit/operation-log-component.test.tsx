import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OperationLog } from '../../src/sidepanel/components/OperationLog';
import type { OperationLogEntry } from '../../src/storage/operation-log';

const detailedEntry: OperationLogEntry = {
  id: 'log-1',
  timestamp: '2026-08-31T14:00:00.000Z',
  stage: 'ai',
  outcome: 'success',
  message: 'AI 扩写已完成',
  displayTitle: '当时生成的标题',
  operationLabel: 'AI 扩写',
  details: {
    draft: {
      sourceUrl: 'https://item.jd.com/1.html',
      title: '当时生成的标题',
      description: '当时生成的描述',
      price: 88,
      originalPrice: 99,
      shippingMethod: '包邮',
      categoryNote: '分类备注',
      selectedImageCount: 1,
      videoName: 'local-video.mp4'
    },
    warnings: ['请核对规格'],
    result: '标题与描述已填入表单'
  }
};

describe('OperationLog', () => {
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

  it('一次最多展开一条，并在复制失败时给出反馈', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('clipboard unavailable'));
    const secondEntry = { ...detailedEntry, id: 'log-2', displayTitle: '第二条标题' };

    render(<OperationLog entries={[detailedEntry, secondEntry]} />);

    fireEvent.click(screen.getByRole('button', { name: /当时生成的标题/u }));
    fireEvent.click(screen.getByRole('button', { name: /第二条标题/u }));

    expect(screen.getByRole('button', { name: /当时生成的标题/u })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: /第二条标题/u })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));

    expect(await screen.findByText('复制失败，请手动选择链接')).toBeVisible();
  });
});
