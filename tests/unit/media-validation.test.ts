import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_BYTES,
  MAX_MEDIA_COUNT,
  MAX_TOTAL_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  validateImageBatch,
  validateVideo
} from '../../src/media/validation';

describe('validateImageBatch', () => {
  it('批量选择时保留合法图片并逐项返回拒绝原因', () => {
    const result = validateImageBatch(
      [
        new File(['ok'], 'ok.png', { type: 'image/png' }),
        new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })
      ],
      1
    );

    expect(result.accepted.map((file) => file.name)).toEqual(['ok.png']);
    expect(result.rejected).toEqual([
      { fileName: 'bad.svg', reason: '仅支持 JPEG、PNG、WebP 图片' }
    ]);
  });

  it('在可用名额已满时拒绝后续合法图片', () => {
    const result = validateImageBatch(
      [
        new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
        new File(['two'], 'two.webp', { type: 'image/webp' })
      ],
      1
    );

    expect(result.accepted.map((file) => file.name)).toEqual(['one.jpg']);
    expect(result.rejected).toEqual([
      {
        fileName: 'two.webp',
        reason: `图片和视频合计最多只能添加 ${String(MAX_MEDIA_COUNT)} 个`
      }
    ]);
  });

  it('拒绝超过单张限制或本次累计限制的图片', () => {
    const oversized = new File(['small'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: MAX_IMAGE_BYTES + 1 });
    const batchOverflow = new File(['small'], 'overflow.webp', { type: 'image/webp' });
    Object.defineProperty(batchOverflow, 'size', { value: 1 });

    const result = validateImageBatch(
      [
        oversized,
        new File([new Uint8Array(MAX_IMAGE_BYTES)], 'first.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array(MAX_IMAGE_BYTES)], 'second.jpg', { type: 'image/jpeg' }),
        batchOverflow
      ],
      MAX_MEDIA_COUNT
    );

    expect(result.accepted.map((file) => file.name)).toEqual(['first.jpg', 'second.jpg']);
    expect(result.rejected).toEqual([
      { fileName: 'large.png', reason: '图片不能超过 10 MB' },
      {
        fileName: 'overflow.webp',
        reason: `图片总大小不能超过 ${String(MAX_TOTAL_IMAGE_BYTES / 1024 / 1024)} MB`
      }
    ]);
  });
});

describe('validateVideo', () => {
  it('拒绝超过 100 MB 的视频并保留可用的 MP4', () => {
    expect(validateVideo(new File(['ok'], 'demo.mp4', { type: 'video/mp4' }))).toEqual({
      ok: true,
      mimeType: 'video/mp4'
    });
    const oversized = new File(['x'], 'large.mov', { type: 'video/quicktime' });
    Object.defineProperty(oversized, 'size', { value: MAX_VIDEO_BYTES + 1 });

    expect(validateVideo(oversized)).toEqual({ ok: false, reason: '视频不能超过 100 MB' });
  });

  it('在浏览器没有提供 MIME 时仅按 MP4 或 MOV 后缀接受并规范化类型', () => {
    expect(validateVideo(new File(['video'], 'clip.MOV'))).toEqual({
      ok: true,
      mimeType: 'video/quicktime'
    });
    expect(validateVideo(new File(['video'], 'clip.avi'))).toEqual({
      ok: false,
      reason: '仅支持 MP4、MOV 视频'
    });
  });
});
