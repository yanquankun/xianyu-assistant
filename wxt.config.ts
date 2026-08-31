import { defineConfig } from 'wxt';

export const REQUIRED_PERMISSIONS = [
  'sidePanel',
  'storage',
  'unlimitedStorage',
  'activeTab',
  'scripting',
  'tabs'
] as const;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => ({
    name: '闲鱼上架助手',
    description: '解析淘宝和京东商品，生成可编辑文案并填入闲鱼发布页。',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: REQUIRED_PERMISSIONS,
    host_permissions: [
      'https://www.goofish.com/*',
      ...(mode === 'e2e'
        ? ['https://item.taobao.com/*', 'https://item.jd.com/*', 'http://127.0.0.1/*']
        : [])
    ],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: {
      default_title: '打开闲鱼上架助手',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png'
      }
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png'
    }
  })
});
