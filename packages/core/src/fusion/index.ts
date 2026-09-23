import type {
  DomElementRef,
  NormalizedSignal,
  Rect,
  SensitivityCategory,
  SensitivityMap,
  SensitivityRegion,
  SignalSource,
} from '../types';
import { computeIoU, unionRect } from './geometry';
import { higherPriorityCategory, mapCategoryToSanitizationAction } from './priority';

export interface FusionInput {
  domSignals: NormalizedSignal[];
  visualSignals: NormalizedSignal[];
  faceSignals: NormalizedSignal[];
  piiSignals: NormalizedSignal[];
}

export interface FusionConfig {
  minimumConfidenceThreshold: number;
  mergeThreshold: number;
  domAssociationThreshold: number;
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  minimumConfidenceThreshold: 0.5,
  mergeThreshold: 0.5,
  domAssociationThreshold: 0.3,
};

interface WorkingRegion {
  boundingBox: Rect;
  category: SensitivityCategory;
  confidence: number;
  sources: SignalSource[];
  failSafe: boolean;
  elementId: string | null;
}

function mergeTwo(a: WorkingRegion, b: WorkingRegion): WorkingRegion {
  const sources = Array.from(new Set([...a.sources, ...b.sources]));
  return {
    boundingBox: unionRect(a.boundingBox, b.boundingBox),
    category: higherPriorityCategory(a.category, b.category),
    confidence: Math.max(a.confidence, b.confidence),
    sources,
    failSafe: a.failSafe || b.failSafe,
    elementId: a.elementId ?? b.elementId,
  };
}

export function fuseSignals(
  input: FusionInput,
  domElements: DomElementRef[],
  screenshotDims: { w: number; h: number },
  captureTimestamp: number,
  config: FusionConfig = DEFAULT_FUSION_CONFIG,
): SensitivityMap {
  const allSignals = [
    ...input.domSignals,
    ...input.visualSignals,
    ...input.faceSignals,
    ...input.piiSignals,
  ].filter((s) => s.category !== 'UI_ELEMENT');

  let working: WorkingRegion[] = allSignals.map((s) => ({
    boundingBox: s.boundingBox,
    category: s.category,
    confidence: s.confidence,
    sources: [s.source],
    failSafe: s.confidence < config.minimumConfidenceThreshold,
    elementId: s.elementId,
  }));

  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    for (let i = 0; i < working.length && !mergedAny; i++) {
      for (let j = i + 1; j < working.length; j++) {
        if (computeIoU(working[i].boundingBox, working[j].boundingBox) > config.mergeThreshold) {
          const merged = mergeTwo(working[i], working[j]);
          working = [...working.slice(0, i), ...working.slice(i + 1, j), ...working.slice(j + 1), merged];
          mergedAny = true;
          break;
        }
      }
    }
  }

  for (const region of working) {
    if (region.elementId) continue;
    let bestIoU = config.domAssociationThreshold;
    let bestId: string | null = null;
    for (const el of domElements) {
      const iou = computeIoU(region.boundingBox, el.boundingBox);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestId = el.elementId;
      }
    }
    region.elementId = bestId;
  }

  working.sort(
    (a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x,
  );

  const regions: SensitivityRegion[] = working.map((r, idx) => ({
    regionId: `r-${String(idx + 1).padStart(3, '0')}`,
    boundingBox: r.boundingBox,
    elementId: r.elementId,
    category: r.category,
    confidence: r.confidence,
    sources: r.sources,
    sanitizationAction: mapCategoryToSanitizationAction(r.category),
    failSafe: r.failSafe,
  }));

  return { captureTimestamp, screenshotDims, regions };
}

export { computeIoU, unionRect } from './geometry';
export { higherPriorityCategory, mapCategoryToSanitizationAction } from './priority';
