import { describe, expect, it } from 'vitest';

import { runtimeMessageTypes } from '../../src/domain/messages';

describe('最终发布安全门禁', () => {
  it('消息协议不存在最终发布动作', () => {
    expect(runtimeMessageTypes).not.toContain('PUBLISH');
    expect(runtimeMessageTypes).not.toContain('CLICK_PUBLISH');
  });
});
