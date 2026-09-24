import type { Rect } from '../types';

export interface LetterboxParams {
  scale: number;
  padLeft: number;
  padTop: number;
  targetSize: number;
  srcWidth: number;
  srcHeight: number;
}

export function computeLetterboxParams(
  srcWidth: number,
  srcHeight: number,
  targetSize: number,
): LetterboxParams {
  const scale = Math.min(targetSize / srcWidth, targetSize / srcHeight);
  const scaledW = Math.round(srcWidth * scale);
  const scaledH = Math.round(srcHeight * scale);
  const padLeft = Math.floor((targetSize - scaledW) / 2);
  const padTop = Math.floor((targetSize - scaledH) / 2);
  return { scale, padLeft, padTop, targetSize, srcWidth, srcHeight };
}

export function inverseTransformBox(box: Rect, params: LetterboxParams): Rect {
  const x = (box.x - params.padLeft) / params.scale;
  const y = (box.y - params.padTop) / params.scale;
  const w = box.w / params.scale;
  const h = box.h / params.scale;

  const clampedX = Math.max(0, Math.min(x, params.srcWidth));
  const clampedY = Math.max(0, Math.min(y, params.srcHeight));
  const clampedW = Math.max(0, Math.min(w, params.srcWidth - clampedX));
  const clampedH = Math.max(0, Math.min(h, params.srcHeight - clampedY));

  return { x: clampedX, y: clampedY, w: clampedW, h: clampedH };
}
