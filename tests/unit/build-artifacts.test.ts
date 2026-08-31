import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const distDirectory = resolve(projectRoot, 'dist');

describe('Chrome 构建产物', () => {
  it(
    'build 同时生成商店 ZIP 和可见的本地加载目录',
    () => {
      rmSync(distDirectory, { recursive: true, force: true });

      execFileSync('pnpm', ['build'], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      const zipPath = resolve(distDirectory, 'xianyu-assistant-0.1.0-chrome.zip');
      const manifestPath = resolve(
        distDirectory,
        'xianyu-assistant-unpacked',
        'manifest.json'
      );

      expect(existsSync(zipPath)).toBe(true);
      expect(readFileSync(zipPath).subarray(0, 2).toString('ascii')).toBe('PK');
      expect(existsSync(manifestPath)).toBe(true);
    },
    60_000
  );
});
