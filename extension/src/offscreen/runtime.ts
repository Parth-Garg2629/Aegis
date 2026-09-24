import { slog } from '@aegis/shared';
import type { DecodeConfig, DomElementRef } from '@aegis/core';
import { AegisFaceDetector } from './face';
import { VisualModelManager } from './model-manager';
import { runPerceptionCycle, type PerceptionCycleInput, type PerceptionCycleResult } from './pipeline';

const CLASS_NAMES = [
  'button',
  'input_field',
  'text_region',
  'link',
  'image',
  'icon',
  'dropdown',
  'checkbox',
  'radio',
] as const;

const MODEL_INPUT_SIZE = 320;
const MODEL_GRID_SIZE = 20;

const decodeConfig: DecodeConfig = {
  gridSize: MODEL_GRID_SIZE,
  inputSize: MODEL_INPUT_SIZE,
  numClasses: CLASS_NAMES.length,
  classNames: CLASS_NAMES,
  confidenceThreshold: 0.4,
};

const hasChromeRuntime = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL;

const modelManager = new VisualModelManager({
  modelUrl: hasChromeRuntime ? chrome.runtime.getURL('assets/models/aegis-nano.onnx') : '',
  wasmPaths: hasChromeRuntime ? chrome.runtime.getURL('assets/ort/') : '',
  inputName: 'input',
  inputShape: [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE],
});

const faceDetector = new AegisFaceDetector();

let visualReady = false;
let faceReady = false;

async function initPerception(): Promise<void> {
  if (!hasChromeRuntime) {
    return;
  }
  const [v, f] = await Promise.all([
    modelManager.load(),
    faceDetector.load({
      wasmBasePath: chrome.runtime.getURL('assets/mediapipe/wasm'),
      modelAssetPath: chrome.runtime.getURL('assets/mediapipe/blaze_face_short_range.tflite'),
    }),
  ]);
  visualReady = v;
  faceReady = f;
  slog.info({
    module: 'OFFSCREEN_RUNTIME',
    event: 'PERCEPTION_INIT_COMPLETE',
    status: `visual_ml=${v ? 'ready' : 'degraded'},face_detection=${f ? 'ready' : 'degraded'}`,
  });
}

void initPerception();

export interface RunPerceptionCycleMessage {
  type: 'RUN_PERCEPTION_CYCLE';
  screenshotDataUrl: string;
  screenshotDims: { w: number; h: number };
  domElements: DomElementRef[];
}

if (hasChromeRuntime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(
    (message: RunPerceptionCycleMessage, _sender, sendResponse: (response: PerceptionCycleResult | null) => void) => {
      if (message?.type !== 'RUN_PERCEPTION_CYCLE') return false;

      const input: PerceptionCycleInput = {
        screenshotDataUrl: message.screenshotDataUrl,
        screenshotDims: message.screenshotDims,
        domElements: message.domElements,
        domSignals: [],
        piiSignals: [],
      };

      runPerceptionCycle(input, {
        visual: visualReady ? { modelManager, decodeConfig, sourceModel: 'aegis-nano-v1' } : null,
        faceDetector: faceReady ? faceDetector : null,
      })
        .then((result) => sendResponse(result))
        .catch((err: unknown) => {
          slog.error({
            module: 'OFFSCREEN_RUNTIME',
            event: 'PERCEPTION_CYCLE_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
          sendResponse(null);
        });

      return true;
    },
  );
}

slog.info({
  module: 'OFFSCREEN_RUNTIME',
  event: 'OFFSCREEN_INITIALIZED',
  status: 'READY',
});
