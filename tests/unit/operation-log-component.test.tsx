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
      sourceUrl: 'https://3.cn/submitted',
      canonicalUrl: 'https://item.jd.com/1.html',
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
    expect(screen.getByText('提交链接')).toBeVisible();
    expect(screen.getByText('最终规范链接')).toBeVisible();
    expect(screen.getByText('https://3.cn/submitted')).toBeVisible();
    expect(screen.getByText('https://item.jd.com/1.html')).toBeVisible();
    expect(screen.getByRole('button', { name: '复制提交链接' })).toBeVisible();
    expect(screen.getByRole('button', { name: '打开最终规范链接' })).toBeVisible();
  });

  it('一次最多展开一条，并在复制失败时给出反馈', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('clipboard unavailable')
    );
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

    fireEvent.click(screen.getByRole('button', { name: '复制最终规范链接' }));

    expect(await screen.findByText('最终规范链接复制失败，请手动选择链接')).toBeVisible();
  });

  it('旧记录的 ID 重复时也只展开被点击的一条', () => {
    const firstEntry: OperationLogEntry = {
      ...detailedEntry,
      id: '[资源标识已脱敏]',
      displayTitle: '第一条登录检查',
      details: { result: '第一条执行结果' }
    };
    const secondEntry: OperationLogEntry = {
      ...detailedEntry,
      id: '[资源标识已脱敏]',
      displayTitle: '第二条登录检查',
      details: { result: '第二条执行结果' }
    };

    render(<OperationLog entries={[firstEntry, secondEntry]} />);

    fireEvent.click(screen.getByRole('button', { name: /第一条登录检查/u }));
    expect(screen.getByText('第一条执行结果')).toBeVisible();
    expect(screen.queryByText('第二条执行结果')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /第二条登录检查/u }));
    expect(screen.queryByText('第一条执行结果')).not.toBeInTheDocument();
    expect(screen.getByText('第二条执行结果')).toBeVisible();
  });

  it('为两个不同链接分别复制和打开，并提供独立反馈', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<OperationLog entries={[detailedEntry]} />);
    fireEvent.click(screen.getByRole('button', { name: /当时生成的标题/u }));

    fireEvent.click(screen.getByRole('button', { name: '复制提交链接' }));
    expect(await screen.findByText('提交链接已复制')).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('https://3.cn/submitted');

    fireEvent.click(screen.getByRole('button', { name: '打开最终规范链接' }));
    expect(await screen.findByText('无法打开最终规范链接')).toBeVisible();
    expect(open).toHaveBeenCalledWith(
      'https://item.jd.com/1.html',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('相同 URL 去重，非 HTTP(S) 值不提供任何动作', () => {
    const sameUrlEntry: OperationLogEntry = {
      ...detailedEntry,
      id: 'same-url',
      details: {
        draft: {
          sourceUrl: 'https://item.jd.com/1.html',
          canonicalUrl: 'https://item.jd.com/1.html'
        }
      }
    };
    const unsafeEntry: OperationLogEntry = {
      ...detailedEntry,
      id: 'unsafe-url',
      displayTitle: '非安全链接',
      details: {
        draft: {
          sourceUrl: 'javascript:alert(1)',
          canonicalUrl: 'file:///tmp/private'
        }
      }
    };
    render(<OperationLog entries={[sameUrlEntry, unsafeEntry]} />);

    fireEvent.click(screen.getByRole('button', { name: /当时生成的标题/u }));
    expect(screen.getAllByText('https://item.jd.com/1.html')).toHaveLength(1);
    expect(screen.getByText('提交链接与最终规范链接')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /非安全链接/u }));
    expect(screen.queryByRole('button', { name: /复制|打开/u })).not.toBeInTheDocument();
  });
});
