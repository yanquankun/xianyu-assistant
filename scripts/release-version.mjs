import { readFile, writeFile } from 'node:fs/promises';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(value) {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) {
    throw new Error(`版本号必须使用 x.y.z 格式：${value}`);
  }

  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }

  return 0;
}

function nextVersion(currentVersion, part) {
  const [major, minor, patch] = parseVersion(currentVersion);
  switch (part) {
    case 'x':
      return `${major + 1}.0.0`;
    case 'y':
      return `${major}.${minor + 1}.0`;
    case 'z':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`升级位必须是 x、y 或 z：${part}`);
  }
}

function validateVersion(candidate, tags) {
  parseVersion(candidate);
  const releasedVersions = tags
    .filter((tag) => tag.startsWith('v'))
    .map((tag) => tag.slice(1))
    .filter((version) => SEMVER_PATTERN.test(version))
    .sort(compareVersions);
  const highestVersion = releasedVersions.at(-1);

  if (highestVersion && compareVersions(candidate, highestVersion) <= 0) {
    throw new Error(`${candidate} 必须高于已有最高版本 ${highestVersion}`);
  }

  return candidate;
}

async function setPackageVersion(packagePath, version) {
  parseVersion(version);
  const contents = await readFile(packagePath, 'utf8');
  const packageJson = JSON.parse(contents);
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    typeof packageJson.version !== 'string'
  ) {
    throw new Error(`${packagePath} 缺少有效的 version 字段`);
  }

  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function main([command, ...args]) {
  switch (command) {
    case 'next':
      globalThis.console.log(nextVersion(args[0] ?? '', args[1] ?? ''));
      return;
    case 'validate':
      globalThis.console.log(validateVersion(args[0] ?? '', args.slice(1)));
      return;
    case 'metadata': {
      const [name = '', version = ''] = args;
      if (!name.trim()) {
        throw new Error('package.json 缺少有效的 name 字段');
      }
      parseVersion(version);
      globalThis.console.log(
        JSON.stringify({
          version,
          tag: `v${version}`,
          crx: `dist/${name}-${version}-chrome.crx`,
          zip: `dist/${name}-${version}-chrome.zip`
        })
      );
      return;
    }
    case 'set':
      await setPackageVersion(args[0] ?? '', args[1] ?? '');
      return;
    case 'notes': {
      const notes = args[0] ?? '';
      if (!notes.trim()) {
        throw new Error('Tag/Release 说明不能为空');
      }
      globalThis.console.log(notes);
      return;
    }
    default:
      throw new Error('用法：release-version.mjs <next|validate|metadata|set|notes> ...');
  }
}

try {
  await main(globalThis.process.argv.slice(2));
} catch (error) {
  globalThis.console.error(error instanceof Error ? error.message : String(error));
  globalThis.process.exitCode = 1;
}
