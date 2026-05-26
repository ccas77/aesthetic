// Client-side image downscale + re-encode. We use this on every upload
// path (book covers, character references, shared-pool stills, category
// stills) because Vercel serverless functions have a ~4.5 MB request
// body limit. A character sheet straight off a phone is easily 6-12 MB
// and would silently fail. After this it's well under 1 MB.

export interface ResizeOptions {
  // Long-edge cap in pixels. Anything bigger is downscaled to this on
  // the longest side, preserving aspect ratio.
  maxEdge?: number;
  // JPEG quality (0..1).
  quality?: number;
  // Output mime. PNG keeps transparency but is much larger; default
  // JPEG which is fine for photos / character sheets.
  mime?: string;
}

export async function resizeImageForUpload(
  file: File,
  opts: ResizeOptions = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1280;
  const quality = opts.quality ?? 0.85;
  const mime = opts.mime ?? "image/jpeg";

  // Decode via createImageBitmap when available; falls back to <img>.
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      bitmap = await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const { width: srcW, height: srcH } = bitmap as { width: number; height: number };
  const longEdge = Math.max(srcW, srcH);
  // If already small enough, hand the original back unchanged.
  if (longEdge <= maxEdge && file.type.startsWith("image/")) {
    closeBitmap(bitmap);
    return file;
  }
  const scale = maxEdge / longEdge;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    closeBitmap(bitmap);
    return file;
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dstW, dstH);
  closeBitmap(bitmap);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  );
  if (!blob) return file;
  const ext = mime === "image/png" ? "png" : "jpg";
  const name = file.name.replace(/\.[^.]+$/, "") + `.${ext}`;
  return new File([blob], name, { type: mime });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function closeBitmap(b: ImageBitmap | HTMLImageElement): void {
  if (typeof (b as ImageBitmap).close === "function") {
    (b as ImageBitmap).close();
  }
}
