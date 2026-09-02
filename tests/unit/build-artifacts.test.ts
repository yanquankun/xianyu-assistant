import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import devConfig from '../../wxt.dev.config';

const projectRoot = process.cwd();
const distDirectory = resolve(projectRoot, 'dist');
const outputUnpackedDirectory = resolve(projectRoot, '.output/chrome-mv3');
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8')
) as { name: string; version: string };

describe('Chrome 构建产物', () => {
  it('build 同时生成 CRX、商店 ZIP 和生产解压目录', () => {
    rmSync(distDirectory, { recursive: true, force: true });

    execFileSync('pnpm', ['build'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    });

    const artifactPrefix = `${packageJson.name}-${packageJson.version}`;
    const zipPath = resolve(distDirectory, `${artifactPrefix}-chrome.zip`);
    const crxPath = resolve(distDirectory, `${artifactPrefix}-chrome.crx`);

    expect(existsSync(zipPath)).toBe(true);
    expect(readFileSync(zipPath).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(existsSync(crxPath)).toBe(true);
    expect(readFileSync(crxPath).subarray(0, 4)).toEqual(Buffer.from('Cr24', 'ascii'));
    const manifestPath = resolve(outputUnpackedDirectory, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      description?: unknown;
      version?: unknown;
    };
    expect(manifest.description).toBe(
      '解析淘宝、天猫和京东商品，生成可编辑文案并填入闲鱼发布页。'
    );
    expect(manifest.version).toBe(packageJson.version);
    expect(existsSync(resolve(distDirectory, 'xianyu-assistant-unpacked'))).toBe(false);
  }, 60_000);

  it('开发配置输出到可见的固定目录', () => {
    const devDirectory = resolve(projectRoot, 'dev-dist');
    rmSync(devDirectory, { recursive: true, force: true });

    const result = spawnSync(
      'pnpm',
      ['exec', 'wxt', 'build', '--config', 'wxt.dev.config.ts', '--mode', 'development'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      }
    );

    expect(result.status).toBe(0);
    expect(existsSync(resolve(devDirectory, 'xianyu-assistant-unpacked', 'manifest.json'))).toBe(
      true
    );
  }, 60_000);

  it('开发服务器只扫描真实的页面入口', async () => {
    const viteConfig = await devConfig.vite?.({
      browser: 'chrome',
      command: 'serve',
      manifestVersion: 3,
      mode: 'development'
    });

    expect(viteConfig?.optimizeDeps?.entries).toEqual(['entrypoints/sidepanel/index.html']);
  });
});
