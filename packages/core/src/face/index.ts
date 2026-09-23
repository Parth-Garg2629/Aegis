import type { FaceSignal, NormalizedSignal, Rect } from '../types';

export const FACE_DETECTION_DISCARD_THRESHOLD = 0.3;

export function denormalizeFaceBox(
  box: Rect,
  screenshotWidth: number,
  screenshotHeight: number,
): Rect {
  return {
    x: box.x * screenshotWidth,
    y: box.y * screenshotHeight,
    w: box.w * screenshotWidth,
    h: box.h * screenshotHeight,
  };
}

let faceSignalCounter = 0;

export function normalizeFaceSignal(
  signal: FaceSignal,
  screenshotWidth: number,
  screenshotHeight: number,
): NormalizedSignal | null {
  if (signal.confidence < FACE_DETECTION_DISCARD_THRESHOLD) return null;

  faceSignalCounter += 1;
  return {
    signalId: `face-${faceSignalCounter}`,
    source: 'FACE_DETECTION',
    elementId: null,
    boundingBox: denormalizeFaceBox(signal.boundingBox, screenshotWidth, screenshotHeight),
    category: 'FACE',
    confidence: signal.confidence,
    evidence: 'face_detected',
  };
}
