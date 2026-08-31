import { getRemoteImageUrl, type ProductImage } from '../../domain/product';

interface ImagePickerProps {
  images: readonly ProductImage[];
  onToggle: (id: string) => void;
  onLoadStatus: (id: string, status: ProductImage['loadStatus']) => void;
}

export function ImagePicker({ images, onToggle, onLoadStatus }: ImagePickerProps) {
  if (images.length === 0) {
    return <p className="empty-note">没有解析到图片，可返回来源页面检查。</p>;
  }
  return (
    <div className="image-grid" aria-label="商品图片">
      {images.map((image, index) => {
        const remoteUrl = getRemoteImageUrl(image);
        return (
          <label
            className={`image-tile${image.selected ? ' image-tile--selected' : ''}`}
            key={image.id}
          >
            {remoteUrl === null ? (
              <span>本地图片将在媒体选择器中显示</span>
            ) : (
              <img
                src={remoteUrl}
                alt={`商品图片 ${String(index + 1)}`}
                onLoad={() => onLoadStatus(image.id, 'loaded')}
                onError={() => onLoadStatus(image.id, 'failed')}
              />
            )}
            <input
              type="checkbox"
              checked={image.selected}
              disabled={image.loadStatus === 'failed'}
              onChange={() => onToggle(image.id)}
              aria-label={`选择商品图片 ${String(index + 1)}`}
            />
            <span>
              {image.loadStatus === 'failed' ? '加载失败' : image.selected ? '已选择' : '未选择'}
            </span>
          </label>
        );
      })}
    </div>
  );
}
