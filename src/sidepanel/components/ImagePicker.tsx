import type { ProductImage } from '../../domain/product';

interface ImagePickerProps {
  images: readonly ProductImage[];
  onToggle: (id: string) => void;
}

export function ImagePicker({ images, onToggle }: ImagePickerProps) {
  if (images.length === 0) {
    return <p className="empty-note">没有解析到图片，可返回来源页面检查。</p>;
  }
  return (
    <div className="image-grid" aria-label="商品图片">
      {images.map((image, index) => (
        <label className={`image-tile${image.selected ? ' image-tile--selected' : ''}`} key={image.id}>
          <img src={image.url} alt={`商品图片 ${String(index + 1)}`} />
          <input
            type="checkbox"
            checked={image.selected}
            onChange={() => onToggle(image.id)}
            aria-label={`选择商品图片 ${String(index + 1)}`}
          />
          <span>{image.selected ? '已选择' : '未选择'}</span>
        </label>
      ))}
    </div>
  );
}
