import type { NormalizedSignal, Rect, UIElementClass, VisualSignal } from '../types';
import { decodeGridOutput, type DecodeConfig } from './decode';
import { inverseTransformBox, type LetterboxParams } from './letterbox';
import { nonMaxSuppression } from './nms';

export { computeLetterboxParams, inverseTransformBox, type LetterboxParams } from './letterbox';
export { decodeGridOutput, type DecodeConfig } from './decode';
export { nonMaxSuppression, type RawDetection } from './nms';

export const VISUAL_ML_DEFAULTS = {
  confidenceThreshold: 0.4,
  nmsIouThreshold: 0.45,
  maxDetections: 100,
} as const;

export interface PostprocessOptions {
  nmsIouThreshold?: number;
  maxDetections?: number;
  sourceModel: string;
}

export function postprocessDetections(
  rawOutput: Float32Array,
  decodeConfig: DecodeConfig,
  letterboxParams: LetterboxParams,
  options: PostprocessOptions,
): VisualSignal[] {
  const raw = decodeGridOutput(rawOutput, decodeConfig);
  const suppressed = nonMaxSuppression(
    raw,
    options.nmsIouThreshold ?? VISUAL_ML_DEFAULTS.nmsIouThreshold,
    options.maxDetections ?? VISUAL_ML_DEFAULTS.maxDetections,
  );

  return suppressed.map((d) => ({
    boundingBox: inverseTransformBox(d.box, letterboxParams),
    label: decodeConfig.classNames[d.classId] as UIElementClass,
    confidence: d.confidence,
    sourceModel: options.sourceModel,
  }));
}

let visualSignalCounter = 0;

export function normalizeVisualSignal(signal: VisualSignal): NormalizedSignal {
  visualSignalCounter += 1;
  return {
    signalId: `visual-${visualSignalCounter}`,
    source: 'VISUAL_ML',
    elementId: null,
    boundingBox: signal.boundingBox,
    category: 'UI_ELEMENT',
    confidence: signal.confidence,
    evidence: signal.label,
  };
}

export function boxArea(box: Rect): number {
  return Math.max(0, box.w) * Math.max(0, box.h);
}
