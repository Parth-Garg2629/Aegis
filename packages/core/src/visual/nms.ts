import type { Rect } from '../types';
import { computeIoU } from '../fusion/geometry';

export interface RawDetection {
  box: Rect;
  confidence: number;
  classId: number;
}

export function nonMaxSuppression(
  detections: RawDetection[],
  iouThreshold: number,
  maxDetections: number,
): RawDetection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: RawDetection[] = [];

  for (const det of sorted) {
    if (kept.length >= maxDetections) break;
    const suppressed = kept.some(
      (k) => k.classId === det.classId && computeIoU(k.box, det.box) > iouThreshold,
    );
    if (!suppressed) kept.push(det);
  }

  return kept;
}
