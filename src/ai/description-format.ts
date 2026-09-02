export function removeBlankDescriptionLines(value: string): string {
  return value.replace(/\r?\n[\t ]*(?:\r?\n)+/gu, '\n');
}
