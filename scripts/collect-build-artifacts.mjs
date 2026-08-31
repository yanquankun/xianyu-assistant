import { spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  constants,
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm
} from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const projectRoot = globalThis.process.cwd();
const outputDirectory = resolve(projectRoot, '.output');
const distDirectory = resolve(projectRoot, 'dist');
const keyDirectory = resolve(projectRoot, '.keys');
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

if (unpackedOnly) {
  await cp(sourceUnpackedDirectory, targetUnpackedDirectory, { recursive: true });
  globalThis.console.log(`本地加载目录：${targetUnpackedDirectory}`);
} else {
  const archiveName = `${packageJson.name}-${packageJson.version}-chrome.zip`;
  const targetArchive = resolve(distDirectory, archiveName);
  const crxName = `${packageJson.name}-${packageJson.version}-chrome.crx`;
  const targetCrx = resolve(distDirectory, crxName);
  const generatedCrx = `${sourceUnpackedDirectory}.crx`;
  const generatedKey = `${sourceUnpackedDirectory}.pem`;
  const privateKey = resolve(keyDirectory, `${packageJson.name}.pem`);
  const hasPrivateKey = await pathExists(privateKey);
  const chromeBinary = await findChromeBinary();

  await copyFile(resolve(outputDirectory, archiveName), targetArchive);
  await rm(generatedCrx, { force: true });

  if (!hasPrivateKey) {
    await rm(generatedKey, { force: true });
  }

  const args = [`--pack-extension=${sourceUnpackedDirectory}`];
  if (hasPrivateKey) {
    args.push(`--pack-extension-key=${privateKey}`);
  }

  const result = spawnSync(chromeBinary, args, {
    encoding: 'utf8',
    timeout: 60_000
  });

  if (result.error || result.status !== 0 || !(await pathExists(generatedCrx))) {
    const details = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join('\n');
    throw new Error(`Chrome 打包 CRX 失败。${details ? `\n${details}` : ''}`);
  }

  if (!hasPrivateKey) {
    if (!(await pathExists(generatedKey))) {
      throw new Error('Chrome 已生成 CRX，但没有生成首次打包所需的 PEM 私钥。');
    }
    await mkdir(keyDirectory, { recursive: true });
    await rename(generatedKey, privateKey);
    await chmod(privateKey, 0o600);
    globalThis.console.log(`首次生成的 CRX 私钥：${privateKey}`);
  }

  await rename(generatedCrx, targetCrx);
  globalThis.console.log(`Chrome CRX 安装包：${targetCrx}`);
  globalThis.console.log(`Chrome 应用商店上传包：${targetArchive}`);
}

async function findChromeBinary() {
  const explicitBinary = globalThis.process.env.CHROME_BINARY;
  const absoluteCandidates = [
    explicitBinary,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

  for (const candidate of absoluteCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续检查下一个候选路径。
    }
  }

  throw new Error(
    '没有找到可执行的 Chrome。请安装 Google Chrome，或通过 CHROME_BINARY 指定浏览器可执行文件。'
  );
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
