import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createExtensionManifest } from '../../wxt.config';

const projectRoot = process.cwd();
const versionScript = resolve(projectRoot, 'scripts/release-version.mjs');
const releaseScript = resolve(projectRoot, 'scripts/release.sh');
const githubAuthScript = resolve(projectRoot, 'scripts/check-github-auth.sh');
const releaseUiScript = resolve(projectRoot, 'scripts/release-ui.sh');

function runVersionCommand(...args: string[]) {
  return spawnSync(process.execPath, [versionScript, ...args], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
}

function runUiFunction(functionCall: string, ...args: string[]) {
  return spawnSync(
    'bash',
    ['-c', `source "$1"; ${functionCall}`, 'release-ui-test', releaseUiScript, ...args],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, RELEASE_UI_PLAIN: '1' }
    }
  );
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

  it('将版本选项渲染为短行纵向菜单并默认选中 z', () => {
    const result = runUiFunction(
      'render_version_menu "$2" "$3" "$4" "$5" "$6"',
      '0',
      '0.1.3',
      '0.1.4',
      '0.2.0',
      '1.0.0'
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      [
        '请选择版本升级类型',
        '',
        '❯ z  补丁版本  0.1.3 → 0.1.4（默认）',
        '  y  次版本    0.1.3 → 0.2.0',
        '  x  主版本    0.1.3 → 1.0.0',
        '',
        '↑/↓ 选择，Enter 确认，q 取消',
        ''
      ].join('\n')
    );
  });

  it.each([
    ['0', 'up', '2'],
    ['0', 'down', '1'],
    ['2', 'down', '0']
  ])('从索引 %s 向 %s 循环移动到 %s', (current, direction, expected) => {
    const result = runUiFunction('move_selection "$2" "$3" "$4"', current, direction, '3');

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  });

  it('最终确认使用纵向单选并默认选中取消', () => {
    const result = runUiFunction('render_confirmation_menu "$2"', '1');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('  确认发布');
    expect(result.stdout).toContain('❯ 取消并恢复版本（默认）');
  });

  it('在文字之前输出 ANSI 高亮样式', () => {
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; ui_print_line "选中项" "${UI_BOLD}${UI_CYAN}"',
        'release-ui-color-test',
        releaseUiScript
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, RELEASE_UI_FORCE_COLOR: '1' }
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('\u001B[1m\u001B[36m选中项\u001B[0m');
  });

  it('使用本地 token 快速检查 gh 登录状态', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'xianyu-gh-auth-'));
    const fakeGhPath = join(temporaryDirectory, 'gh');
    const argumentsPath = join(temporaryDirectory, 'arguments.txt');
    writeFileSync(
      fakeGhPath,
      `#!/usr/bin/env bash\nprintf '%s' "$*" > "${argumentsPath}"\n`
    );
    chmodSync(fakeGhPath, 0o755);

    try {
      const result = spawnSync('bash', [githubAuthScript], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${temporaryDirectory}:${process.env.PATH ?? ''}` }
      });

      expect(result.status).toBe(0);
      expect(readFileSync(argumentsPath, 'utf8')).toBe('auth token --hostname github.com');
      expect(result.stdout).toContain('GitHub CLI 登录检查通过');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('本地没有 gh token 时返回明确登录指令', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'xianyu-gh-auth-failure-'));
    const fakeGhPath = join(temporaryDirectory, 'gh');
    writeFileSync(fakeGhPath, '#!/usr/bin/env bash\nexit 1\n');
    chmodSync(fakeGhPath, 0o755);

    try {
      const result = spawnSync('bash', [githubAuthScript], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${temporaryDirectory}:${process.env.PATH ?? ''}` }
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('请先执行 gh auth login');
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
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
