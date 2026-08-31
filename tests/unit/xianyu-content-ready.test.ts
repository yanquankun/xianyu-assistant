import { describe, expect, it } from 'vitest';

import {
  sendXianyuMessage,
  type XianyuContentDependencies
} from '../../src/xianyu/content-ready';

function createDependencies(
  overrides: Partial<XianyuContentDependencies> = {}
): XianyuContentDependencies {
  return {
    waitForComplete: () => Promise.resolve(),
    getTabUrl: () => Promise.resolve('https://www.goofish.com/publish'),
    sendMessage: <T>() => Promise.resolve('logged-in' as T),
    inject: () => Promise.resolve(),
    ...overrides
  };
}

describe('sendXianyuMessage', () => {
  it('先等待页面完成，再向已有内容脚本发送消息', async () => {
    const calls: string[] = [];
    const result = await sendXianyuMessage<string>(
      createDependencies({
        waitForComplete: () => {
          calls.push('wait');
          return Promise.resolve();
        },
        getTabUrl: () => {
          calls.push('url');
          return Promise.resolve('https://www.goofish.com/publish');
        },
        sendMessage: <T>() => {
          calls.push('send');
          return Promise.resolve('ok' as T);
        }
      }),
      7,
      { type: 'CHECK_XIANYU_LOGIN' }
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['wait', 'url', 'send']);
  });

  it('没有接收者时注入一次内容脚本并限次重试', async () => {
    const calls: string[] = [];
    let sends = 0;
    const result = await sendXianyuMessage<string>(
      createDependencies({
        sendMessage: <T>() => {
          sends += 1;
          calls.push(`send-${String(sends)}`);
          return sends === 1
            ? Promise.reject(new Error('Receiving end does not exist'))
            : Promise.resolve('ready' as T);
        },
        inject: () => {
          calls.push('inject');
          return Promise.resolve();
        }
      }),
      8,
      { type: 'CHECK_XIANYU_LOGIN' }
    );

    expect(result).toBe('ready');
    expect(calls).toEqual(['send-1', 'inject', 'send-2']);
  });

  it('页面加载后离开闲鱼时拒绝注入和发送', async () => {
    let injected = false;
    const operation = sendXianyuMessage(
      createDependencies({
        getTabUrl: () => Promise.resolve('https://example.com/'),
        inject: () => {
          injected = true;
          return Promise.resolve();
        }
      }),
      9,
      { type: 'CHECK_XIANYU_LOGIN' }
    );

    await expect(operation).rejects.toThrow('目标标签页已离开闲鱼');
    expect(injected).toBe(false);
  });
});
