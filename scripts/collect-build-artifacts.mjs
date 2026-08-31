import { copyFile, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const projectRoot = globalThis.process.cwd();
const outputDirectory = resolve(projectRoot, '.output');
const distDirectory = resolve(projectRoot, 'dist');
const unpackedOnly = globalThis.process.argv.includes('--unpacked-only');

if (dirname(distDirectory) !== projectRoot || basename(distDirectory) !== 'dist') {
  throw new Error('拒绝清理无法确认的构建目录。');
}

const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, 'package.json'), 'utf8')
);

if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
  throw new Error('package.json 缺少有效的 name 或 version。');
}

const sourceUnpackedDirectory = resolve(outputDirectory, 'chrome-mv3');
const targetUnpackedDirectory = resolve(
  distDirectory,
  `${packageJson.name}-unpacked`
);

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await cp(sourceUnpackedDirectory, targetUnpackedDirectory, { recursive: true });

globalThis.console.log(`本地加载目录：${targetUnpackedDirectory}`);

if (!unpackedOnly) {
  const archiveName = `${packageJson.name}-${packageJson.version}-chrome.zip`;
  const targetArchive = resolve(distDirectory, archiveName);

  await copyFile(resolve(outputDirectory, archiveName), targetArchive);
  globalThis.console.log(`Chrome 应用商店上传包：${targetArchive}`);
}
