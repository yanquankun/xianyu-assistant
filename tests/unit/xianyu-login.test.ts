import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectLoginState,
  parseXianyuLoginCheckResult,
  parseXianyuLoginState
} from '../../src/xianyu/login';

function fixture(name: string): Document {
  const html = readFileSync(resolve(process.cwd(), 'tests', 'fixtures', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('detectLoginState', () => {
  it('登录页明确返回未登录', () => {
    expect(
      detectLoginState(fixture('xianyu-logged-out.html'), 'https://www.goofish.com/login')
    ).toBe('logged-out');
  });

  it('包含用户标识和发布表单时返回已登录', () => {
    expect(detectLoginState(fixture('xianyu-publish.html'), 'https://www.goofish.com/publish')).toBe(
      'logged-in'
    );
  });

  it('页面既没有登录提示也没有用户标识时返回未知', () => {
    const document = new DOMParser().parseFromString(
      '<!doctype html><html><body><main>页面加载中</main></body></html>',
      'text/html'
    );

    expect(detectLoginState(document, 'https://www.goofish.com/')).toBe('unknown');
  });

  it('非闲鱼域名始终返回未知', () => {
    expect(detectLoginState(fixture('xianyu-publish.html'), 'https://example.com/publish')).toBe(
      'unknown'
    );
  });

  it('只接受三个约定的内容脚本登录状态', () => {
    expect(parseXianyuLoginState('logged-in')).toBe('logged-in');
    expect(parseXianyuLoginState('unexpected')).toBeNull();
    expect(parseXianyuLoginState({ state: 'logged-in' })).toBeNull();
  });

  it('拒绝状态非法、消息为空或超长的后台登录结果', () => {
    expect(parseXianyuLoginCheckResult({ state: 'unexpected', message: '错误' })).toBeNull();
    expect(parseXianyuLoginCheckResult({ state: 'logged-in', message: ' ' })).toBeNull();
    expect(
      parseXianyuLoginCheckResult({ state: 'logged-in', message: 'a'.repeat(301) })
    ).toBeNull();
  });
});
