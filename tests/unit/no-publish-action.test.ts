import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeMessageTypes } from '../../src/domain/messages';

describe('最终发布安全门禁', () => {
  it('消息协议不存在最终发布动作', () => {
    expect(runtimeMessageTypes).not.toContain('PUBLISH');
    expect(runtimeMessageTypes).not.toContain('CLICK_PUBLISH');
  });

  it('闲鱼填写入口不存在点击或提交表单调用', () => {
    const files = [
      'entrypoints/xianyu.content.ts',
      'src/xianyu/dom.ts',
      'src/xianyu/fill.ts',
      'src/xianyu/media-transfer.ts'
    ];
    const source = files
      .map((file) => readFileSync(resolve(process.cwd(), file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/\.click\s*\(|\.submit\s*\(|requestSubmit\s*\(/u);
  });
});
