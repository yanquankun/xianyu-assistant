export const MAX_SELECTED_IMAGES = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface RejectedMediaFile {
  fileName: string;
  reason: string;
}

export interface ImageBatchValidation {
  accepted: File[];
  rejected: RejectedMediaFile[];
}

export type VideoValidation =
  | { ok: true; mimeType: 'video/mp4' | 'video/quicktime' }
  | { ok: false; reason: string };

export function validateImageBatch(files: readonly File[], remainingSlots: number): ImageBatchValidation {
  const accepted: File[] = [];
  const rejected: RejectedMediaFile[] = [];
  const availableSlots = Math.max(0, Math.min(MAX_SELECTED_IMAGES, Math.floor(remainingSlots)));
  let acceptedByteLength = 0;

  for (const file of files) {
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      rejected.push({ fileName: file.name, reason: '仅支持 JPEG、PNG、WebP 图片' });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejected.push({ fileName: file.name, reason: '图片不能超过 10 MB' });
      continue;
    }
    if (accepted.length >= availableSlots) {
      rejected.push({
        fileName: file.name,
        reason: `最多只能选择 ${String(MAX_SELECTED_IMAGES)} 张图片`
      });
      continue;
    }
    if (acceptedByteLength + file.size > MAX_TOTAL_IMAGE_BYTES) {
      rejected.push({ fileName: file.name, reason: '图片总大小不能超过 20 MB' });
      continue;
    }

    accepted.push(file);
    acceptedByteLength += file.size;
  }

  return { accepted, rejected };
}

export function validateVideo(file: File): VideoValidation {
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, reason: '视频不能超过 100 MB' };
  }

  if (file.type === 'video/mp4' || file.type === 'video/quicktime') {
    return { ok: true, mimeType: file.type };
  }
  if (file.type.length === 0) {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.mp4')) {
      return { ok: true, mimeType: 'video/mp4' };
    }
    if (fileName.endsWith('.mov')) {
      return { ok: true, mimeType: 'video/quicktime' };
    }
  }

  return { ok: false, reason: '仅支持 MP4、MOV 视频' };
}
