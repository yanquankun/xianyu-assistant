import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import devConfig from '../../wxt.dev.config';

const projectRoot = process.cwd();
const distDirectory = resolve(projectRoot, 'dist');

describe('Chrome 构建产物', () => {
  it(
    'build 同时生成 CRX 和商店 ZIP',
    () => {
      rmSync(distDirectory, { recursive: true, force: true });

      execFileSync('pnpm', ['build'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const zipPath = resolve(distDirectory, 'xianyu-assistant-0.1.0-chrome.zip');
      const crxPath = resolve(distDirectory, 'xianyu-assistant-0.1.0-chrome.crx');

      expect(existsSync(zipPath)).toBe(true);
      expect(readFileSync(zipPath).subarray(0, 2).toString('ascii')).toBe('PK');
      expect(existsSync(crxPath)).toBe(true);
      expect(readFileSync(crxPath).subarray(0, 4).toString('ascii')).toBe('Cr24');
      expect(existsSync(resolve(distDirectory, 'xianyu-assistant-unpacked'))).toBe(
        false
      );
    },
    60_000
  );

  it(
    '开发配置输出到可见的固定目录',
    () => {
      const devDirectory = resolve(projectRoot, 'dev-dist');
      rmSync(devDirectory, { recursive: true, force: true });

      const result = spawnSync(
        'pnpm',
        [
          'exec',
          'wxt',
          'build',
          '--config',
          'wxt.dev.config.ts',
          '--mode',
          'development'
        ],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        }
      );

      expect(result.status).toBe(0);
      expect(
        existsSync(
          resolve(devDirectory, 'xianyu-assistant-unpacked', 'manifest.json')
        )
      ).toBe(true);
    },
    60_000
  );

  it('开发服务器只扫描真实的页面入口', async () => {
    const viteConfig = await devConfig.vite?.({
      browser: 'chrome',
      command: 'serve',
      manifestVersion: 3,
      mode: 'development'
    });

    expect(viteConfig?.optimizeDeps?.entries).toEqual([
      'entrypoints/sidepanel/index.html'
    ]);
  });
});
