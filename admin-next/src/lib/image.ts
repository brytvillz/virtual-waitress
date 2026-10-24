// Canvas-based image utilities for upload preprocessing.
// Both functions output JPEG regardless of the input format.

export function resizeImage(
  file: File,
  maxW: number,
  maxH: number,
  quality = 0.82,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('resize failed')); return; }
          resolve(new File([blob], 'image.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}

// Crop a region from the source image and resize it to outW × outH.
// srcX/srcY/srcW/srcH are in the image's natural (unscaled) pixels.
export function cropAndResize(
  file: File,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  quality = 0.82,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      canvas.toBlob(
        blob => {
          if (!blob) { reject(new Error('crop failed')); return; }
          resolve(new File([blob], 'image.jpg', { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
    img.src = url;
  });
}
