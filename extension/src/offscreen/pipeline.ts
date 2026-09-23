import { slog } from '@aegis/shared';
import {
  fuseSignals,
  normalizeVisualSignal,
  normalizeFaceSignal,
  type DomElementRef,
  type FusionConfig,
  type NormalizedSignal,
  type SensitivityMap,
} from '@aegis/core';
import type { AegisFaceDetector } from './face';
import { runVisualDetection, type VisualDetectionDeps } from './visual';

export interface PerceptionStatus {
  visual_ml_available: boolean;
  face_detection_available: boolean;
  dom_analysis_available: boolean;
  heuristic_pii_available: boolean;
}

export interface PerceptionCycleInput {
  screenshotDataUrl: string;
  screenshotDims: { w: number; h: number };
  domElements: DomElementRef[];
  domSignals: NormalizedSignal[];
  piiSignals: NormalizedSignal[];
}

export interface PerceptionCycleDeps {
  visual: VisualDetectionDeps | null;
  faceDetector: AegisFaceDetector | null;
  fusionConfig?: FusionConfig;
  signalTimeoutMs?: number;
}

export interface PerceptionCycleResult {
  sensitivityMap: SensitivityMap;
  perceptionStatus: PerceptionStatus;
  durationMs: number;
}

async function withSignalTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function dataUrlToImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

const DEFAULT_SIGNAL_TIMEOUT_MS = 3000;

export async function runPerceptionCycle(
  input: PerceptionCycleInput,
  deps: PerceptionCycleDeps,
): Promise<PerceptionCycleResult> {
  const start = Date.now();
  const timeoutMs = deps.signalTimeoutMs ?? DEFAULT_SIGNAL_TIMEOUT_MS;

  const visualAvailable = deps.visual !== null && deps.visual.modelManager.getStatus() === 'ready';
  const faceAvailable = deps.faceDetector !== null && deps.faceDetector.isAvailable();

  const visualPromise = visualAvailable
    ? withSignalTimeout(runVisualDetection(input.screenshotDataUrl, deps.visual as VisualDetectionDeps), timeoutMs, [])
    : Promise.resolve([]);

  const facePromise = faceAvailable
    ? withSignalTimeout(
        dataUrlToImageBitmap(input.screenshotDataUrl).then((bitmap) => {
          try {
            return (deps.faceDetector as AegisFaceDetector).detect(bitmap);
          } finally {
            bitmap.close();
          }
        }),
        timeoutMs,
        [],
      )
    : Promise.resolve([]);

  const [visualSignalsRaw, faceSignalsRaw] = await Promise.all([visualPromise, facePromise]);

  const visualSignals: NormalizedSignal[] = visualSignalsRaw.map(normalizeVisualSignal);
  const faceSignals: NormalizedSignal[] = faceSignalsRaw
    .map((s) => normalizeFaceSignal(s, input.screenshotDims.w, input.screenshotDims.h))
    .filter((s): s is NormalizedSignal => s !== null);

  const sensitivityMap = fuseSignals(
    {
      domSignals: input.domSignals,
      visualSignals,
      faceSignals,
      piiSignals: input.piiSignals,
    },
    input.domElements,
    input.screenshotDims,
    Date.now(),
    deps.fusionConfig,
  );

  const perceptionStatus: PerceptionStatus = {
    visual_ml_available: visualAvailable,
    face_detection_available: faceAvailable,
    dom_analysis_available: true,
    heuristic_pii_available: true,
  };

  const durationMs = Date.now() - start;
  slog.info({
    module: 'PERCEPTION_PIPELINE',
    event: 'CYCLE_COMPLETE',
    duration_ms: durationMs,
    sanitized_count: sensitivityMap.regions.length,
  });

  return { sensitivityMap, perceptionStatus, durationMs };
}
