function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeTrailingCommas(jsonText: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const character = jsonText[index];
    if (character === undefined) {
      break;
    }
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let nextIndex = index + 1;
      while (/\s/u.test(jsonText[nextIndex] ?? '')) {
        nextIndex += 1;
      }
      if (jsonText[nextIndex] === '}' || jsonText[nextIndex] === ']') {
        continue;
      }
    }
    result += character;
  }

  return result;
}

function parseJsonRecord(candidate: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    parsed = JSON.parse(removeTrailingCommas(candidate));
  }
  if (!isRecord(parsed)) {
    throw new Error('页面内嵌商品数据不是 JSON 对象');
  }
  return parsed;
}

function findBalancedObjectEnd(scriptText: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < scriptText.length; index += 1) {
    const character = scriptText[index];
    if (character === undefined) {
      break;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      depth += 1;
      continue;
    }
    if (character !== '}') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }
  return null;
}

export function extractAssignedJsonObject(
  scriptText: string,
  variableName: string
): Record<string, unknown> | null {
  const assignmentPattern = new RegExp(
    `(?:^|[^A-Za-z0-9_$])${escapeRegExp(variableName)}\\s*=\\s*\\(?\\s*(\\{)`,
    'gu'
  );
  let foundAssignment = false;
  let lastError: unknown;

  for (const assignment of scriptText.matchAll(assignmentPattern)) {
    foundAssignment = true;
    const relativeBraceIndex = assignment[0].lastIndexOf('{');
    if (relativeBraceIndex < 0) {
      continue;
    }
    const start = assignment.index + relativeBraceIndex;
    const end = findBalancedObjectEnd(scriptText, start);
    if (end === null) {
      lastError = new Error('页面内嵌商品 JSON 对象不完整');
      continue;
    }
    try {
      return parseJsonRecord(scriptText.slice(start, end + 1));
    } catch (error) {
      lastError = error;
    }
  }

  if (!foundAssignment) {
    return null;
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('页面内嵌商品 JSON 对象无法解析');
}
