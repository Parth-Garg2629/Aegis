import type { UIElementClass } from '../types';
import type { RawDetection } from './nms';

export interface DecodeConfig {
  gridSize: number;
  inputSize: number;
  numClasses: number;
  classNames: readonly UIElementClass[];
  confidenceThreshold: number;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function decodeGridOutput(output: Float32Array, config: DecodeConfig): RawDetection[] {
  const { gridSize, inputSize, numClasses, confidenceThreshold } = config;
  const channelsPerCell = 5 + numClasses;
  const stride = inputSize / gridSize;
  const detections: RawDetection[] = [];

  const expectedLength = gridSize * gridSize * channelsPerCell;
  if (output.length !== expectedLength) {
    throw new Error(
      `decodeGridOutput: expected ${expectedLength} values (${gridSize}x${gridSize}x${channelsPerCell}), got ${output.length}`,
    );
  }

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const base = (gy * gridSize + gx) * channelsPerCell;
      const objectness = sigmoid(output[base]);

      let bestClass = 0;
      let bestLogit = -Infinity;
      let sumExp = 0;
      for (let c = 0; c < numClasses; c++) {
        const logit = output[base + 1 + c];
        if (logit > bestLogit) {
          bestLogit = logit;
          bestClass = c;
        }
      }
      for (let c = 0; c < numClasses; c++) {
        sumExp += Math.exp(output[base + 1 + c] - bestLogit);
      }
      const classProb = 1 / sumExp;

      const confidence = objectness * classProb;
      if (confidence < confidenceThreshold) continue;

      const tOff = base + 1 + numClasses;
      const tx = sigmoid(output[tOff]);
      const ty = sigmoid(output[tOff + 1]);
      const tw = sigmoid(output[tOff + 2]);
      const th = sigmoid(output[tOff + 3]);

      const w = tw * inputSize;
      const h = th * inputSize;
      const cx = (gx + tx) * stride;
      const cy = (gy + ty) * stride;

      detections.push({
        box: { x: cx - w / 2, y: cy - h / 2, w, h },
        confidence,
        classId: bestClass,
      });
    }
  }

  return detections;
}
