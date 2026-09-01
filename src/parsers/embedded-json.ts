function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractAssignedJsonObject(
  scriptText: string,
  variableName: string
): Record<string, unknown> | null {
  const assignment = new RegExp(
    `(?:^|[^A-Za-z0-9_$])${escapeRegExp(variableName)}\\s*=\\s*\\(?\\s*(\\{)`,
    'u'
  ).exec(scriptText);
  if (assignment === null) {
    return null;
  }
  const relativeBraceIndex = assignment[0].lastIndexOf('{');
  if (relativeBraceIndex < 0) {
    return null;
  }
  const start = assignment.index + relativeBraceIndex;
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
      const parsed: unknown = JSON.parse(scriptText.slice(start, index + 1));
      if (!isRecord(parsed)) {
        throw new Error('页面内嵌商品数据不是 JSON 对象');
      }
      return parsed;
    }
  }
  throw new Error('页面内嵌商品 JSON 对象不完整');
}
