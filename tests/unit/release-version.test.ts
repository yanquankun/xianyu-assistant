import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createExtensionManifest } from '../../wxt.config';

const projectRoot = process.cwd();
const versionScript = resolve(projectRoot, 'scripts/release-version.mjs');
const releaseScript = resolve(projectRoot, 'scripts/release.sh');

function runVersionCommand(...args: string[]) {
  return spawnSync(process.execPath, [versionScript, ...args], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
}

describe('发布版本工具', () => {
  it('拒绝在非交互式终端中发布', () => {
    const result = spawnSync('bash', [releaseScript], {
      cwd: projectRoot,
      encoding: 'utf8',
      input: '\n'
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('必须在交互式终端中运行');
  });

  it('生产 Manifest 使用传入的 package.json 版本', () => {
    expect(createExtensionManifest('9.8.7', 'production').version).toBe('9.8.7');
  });

  it.each([
    ['x', '1.0.0'],
    ['y', '0.2.0'],
    ['z', '0.1.4']
  ])('按 %s 升级 0.1.3', (part, expected) => {
    const result = runVersionCommand('next', '0.1.3', part);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });

  it('拒绝非三段式正式版本号', () => {
    const result = runVersionCommand('next', '0.1', 'z');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('版本号必须使用 x.y.z 格式');
  });

  it('拒绝不高于已有最高 tag 的发布版本', () => {
    const result = runVersionCommand(
      'validate',
      '0.1.4',
      'v0.1.2',
      'v0.1.4',
      'v0.1.3'
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('0.1.4 必须高于已有最高版本 0.1.4');
  });

  it('拒绝空白的 Tag/Release 说明', () => {
    const result = runVersionCommand('notes', '   ');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('说明不能为空');
  });

  it('接受非空的 Tag/Release 说明', () => {
    const result = runVersionCommand('notes', '修复商品图片解析');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('修复商品图片解析');
  });

  it('接受高于所有已有 tag 的发布版本并忽略无关 tag', () => {
    const result = runVersionCommand(
      'validate',
      '0.2.0',
      'v0.1.9',
      'release-candidate',
      'v0.1.10'
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0.2.0');
  });

  it('生成同一版本对应的 tag 和发布产物名称', () => {
    const result = runVersionCommand('metadata', 'xianyu-assistant', '0.1.4');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      version: '0.1.4',
      tag: 'v0.1.4',
      crx: 'dist/xianyu-assistant-0.1.4-chrome.crx',
      zip: 'dist/xianyu-assistant-0.1.4-chrome.zip'
    });
  });

  it('只修改指定 package.json 的 version 字段', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'xianyu-release-version-'));
    const packagePath = join(temporaryDirectory, 'package.json');
    writeFileSync(
      packagePath,
      `${JSON.stringify({ name: 'fixture-package', version: '0.1.3', private: true }, null, 2)}\n`
    );

    try {
      const result = runVersionCommand('set', packagePath, '0.1.4');

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(packagePath, 'utf8'))).toEqual({
        name: 'fixture-package',
        version: '0.1.4',
        private: true
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
