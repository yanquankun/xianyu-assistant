import { describe, expect, it } from 'vitest';

import { extractAssignedJsonObject } from '../../src/parsers/embedded-json';

describe('extractAssignedJsonObject', () => {
  it('只解析指定赋值中的平衡 JSON 对象并忽略后续代码', () => {
    const script =
      'window._itemInfo = ({"stock":{"skuId":"100"},"text":"} \\" safe","nested":{"items":[{"value":"{"}]}});alert(1)';

    expect(extractAssignedJsonObject(script, 'window._itemInfo')).toEqual({
      stock: { skuId: '100' },
      text: '} " safe',
      nested: { items: [{ value: '{' }] }
    });
  });

  it('赋值不存在时返回 null，且不会误读相似变量名', () => {
    expect(extractAssignedJsonObject('window._itemOnlyExtra = ({"id":"1"})', 'window._itemOnly')).toBeNull();
  });

  it('容忍对象和数组结尾的尾逗号，但不执行后续动态赋值', () => {
    const script = `
      window._itemInfo = ({
        "stock":{"skuId":"100",},
        "images":["a.jpg","b.jpg",],
        "text":"字符串里的 ,} 不能被改写",
        "priceFloor":{"price":"1881.00","afterDesc":{"text":"到手价",},},
      });
      window._itemInfo = {item: window._itemOnly.item};
    `;

    expect(extractAssignedJsonObject(script, 'window._itemInfo')).toEqual({
      stock: { skuId: '100' },
      images: ['a.jpg', 'b.jpg'],
      text: '字符串里的 ,} 不能被改写',
      priceFloor: { price: '1881.00', afterDesc: { text: '到手价' } }
    });
  });

  it('同一脚本的首个赋值不是 JSON 时继续查找后续严格 JSON 赋值', () => {
    const script = `
      window._itemInfo = {item: window._itemOnly.item};
      window._itemInfo = ({"stock":{"skuId":"100"}});
    `;

    expect(extractAssignedJsonObject(script, 'window._itemInfo')).toEqual({
      stock: { skuId: '100' }
    });
  });

  it.each([
    'window._itemInfo = ({bad: 1})',
    'window._itemInfo = ({"stock":{"skuId":"100"})',
    'window._itemInfo = ({"stock":"unterminated})'
  ])('拒绝非严格 JSON 或不完整对象：%s', (script) => {
    expect(() => extractAssignedJsonObject(script, 'window._itemInfo')).toThrow();
  });
});
