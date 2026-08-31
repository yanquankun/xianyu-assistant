export type TextControl = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function visible(element: HTMLElement): boolean {
  if (element.hidden) {
    return false;
  }
  const style = element.getAttribute('style') ?? '';
  return !/display\s*:\s*none|visibility\s*:\s*hidden/iu.test(style);
}

export function findTextControl(
  document: Document,
  selectors: readonly string[],
  labelText: string
): TextControl | null {
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null && visible(element)) {
      return element;
    }
  }

  for (const label of document.querySelectorAll<HTMLLabelElement>('label')) {
    if (!label.innerText.includes(labelText)) {
      continue;
    }
    const control =
      label.control ??
      label.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]');
    if (control !== null && visible(control)) {
      return control;
    }
  }
  return null;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  let prototype: object | null = Object.getPrototypeOf(element) as object | null;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set !== undefined) {
      descriptor.set.call(element, value);
      return;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  throw new Error('输入控件不支持设置值');
}

export function fillTextControl(control: TextControl, value: string): void {
  control.focus();
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    setNativeValue(control, value);
  } else if (control.isContentEditable) {
    control.textContent = value;
  } else {
    throw new Error('目标元素不是可编辑控件');
  }
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
  control.blur();
}

function isVideoFileInput(input: HTMLInputElement): boolean {
  const accept = input.accept.toLowerCase();
  const name = input.name.toLowerCase();
  const accessibleName = input.getAttribute('aria-label')?.toLowerCase() ?? '';
  return accept.includes('video') || name.includes('video') || accessibleName.includes('视频');
}

function labeledFileInput(document: Document, labelText: string): HTMLInputElement | null {
  for (const label of document.querySelectorAll<HTMLLabelElement>('label')) {
    if (!label.innerText.includes(labelText)) {
      continue;
    }
    const input = label.control ?? label.querySelector<HTMLInputElement>('input[type="file"]');
    if (input instanceof HTMLInputElement && input.type === 'file' && visible(input)) {
      return input;
    }
  }
  return null;
}

export function findImageFileInput(document: Document): HTMLInputElement | null {
  const preferred = document.querySelector<HTMLInputElement>('input[name="images"][type="file"]');
  if (preferred !== null && visible(preferred) && !isVideoFileInput(preferred)) {
    return preferred;
  }
  const labeled = labeledFileInput(document, '图片');
  if (labeled !== null && !isVideoFileInput(labeled)) {
    return labeled;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (
      visible(input) &&
      !isVideoFileInput(input) &&
      (input.accept.includes('image') || input.multiple)
    ) {
      return input;
    }
  }
  return null;
}

export function findVideoFileInput(document: Document): HTMLInputElement | null {
  const preferred = document.querySelector<HTMLInputElement>('input[name="video"][type="file"]');
  if (preferred !== null && visible(preferred) && isVideoFileInput(preferred)) {
    return preferred;
  }
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    if (visible(input) && isVideoFileInput(input)) {
      return input;
    }
  }
  const labeled = labeledFileInput(document, '视频');
  return labeled;
}

export function fillFileInput(input: HTMLInputElement, files: readonly File[]): void {
  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(file);
  }
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
