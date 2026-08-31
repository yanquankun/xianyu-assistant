import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog } from '../../src/sidepanel/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('默认聚焦取消并将 Escape 视为取消', () => {
    let cancelled = 0;
    render(
      <ConfirmDialog
        title="返回选择方式"
        description="当前草稿和本地上传的媒体将被删除，运行记录和 AI 配置会保留。"
        cancelLabel="取消"
        confirmLabel="确认返回"
        isConfirming={false}
        onCancel={() => {
          cancelled += 1;
        }}
        onConfirm={() => undefined}
      />
    );

    const dialog = screen.getByRole('dialog', { name: '返回选择方式' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(cancelled).toBe(1);
  });

  it('在取消和确认之间循环键盘焦点', () => {
    render(
      <ConfirmDialog
        title="返回选择方式"
        description="当前草稿和本地上传的媒体将被删除。"
        cancelLabel="取消"
        confirmLabel="确认返回"
        isConfirming={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认返回' });
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });
});
