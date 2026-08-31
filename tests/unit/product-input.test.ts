import { describe, expect, it } from 'vitest';

import { parseProductInput } from '../../src/background/product-input';

describe('parseProductInput', () => {
  it('从京东 Markdown 分享文案只提取第一个 URL 和第一组书名号标题', () => {
    const result = parseProductInput(
      '【京东】[https://3.cn/31-f4Z6b?jkl=@XCWZK4OtWu@](https://3.cn/31-f4Z6b?jkl=@XCWZK4OtWu@) CA1507 「卡西欧男士运动手表节日礼物」 点击链接直接打开'
    );

    expect(result).toEqual({
      submittedUrl: 'https://3.cn/31-f4Z6b?jkl=@XCWZK4OtWu@',
      platformHint: 'jd',
      hintedTitle: '卡西欧男士运动手表节日礼物'
    });
  });

  it('从淘宝分享文案移除链接末尾中英文标点', () => {
    expect(
      parseProductInput('88￥ CZ009 https://e.tb.cn/h.test?tk=abc@123， 「测试淘宝商品」；')
    ).toEqual({
      submittedUrl: 'https://e.tb.cn/h.test?tk=abc@123',
      platformHint: 'taobao',
      hintedTitle: '测试淘宝商品'
    });
  });

  it.each([
    ['https://item.jd.com/100.html', 'jd'],
    ['https://item.taobao.com/item.htm?id=1。', 'taobao'],
    ['https://shop.example.com/product/1;', 'generic']
  ] as const)('接受纯 URL %s', (input, platformHint) => {
    expect(parseProductInput(input)).toEqual({
      submittedUrl: input.replace(/[。;]$/u, ''),
      platformHint
    });
  });

  it('忽略后续重复 Markdown URL 和后续书名号标题', () => {
    expect(
      parseProductInput(
        '[https://3.cn/first](https://3.cn/first) https://3.cn/second 「第一个标题」 「第二个标题」'
      )
    ).toEqual({
      submittedUrl: 'https://3.cn/first',
      platformHint: 'jd',
      hintedTitle: '第一个标题'
    });
  });

  it('没有书名号时不把分享码或其他文案猜成标题', () => {
    expect(parseProductInput('CA1507 https://3.cn/31-f4Z6b 点击链接直接打开')).toEqual({
      submittedUrl: 'https://3.cn/31-f4Z6b',
      platformHint: 'jd'
    });
  });

  it.each(['', '   ', 'CA1507 点击链接直接打开'])('拒绝没有 HTTP(S) URL 的输入', (input) => {
    expect(() => parseProductInput(input)).toThrow('分享内容中没有可用的 HTTP(S) 商品链接');
  });
});
