import { slog } from '@aegis/shared';
import { computeLetterboxParams, postprocessDetections, type DecodeConfig, type LetterboxParams } from '@aegis/core';
import type { VisualSignal } from '@aegis/core';
import type { VisualModelManager } from './model-manager';

const LETTERBOX_PAD_RGB = 114;

async function dataUrlToImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function imageDataToNchwTensor(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const planeSize = width * height;
  const tensor = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[planeSize + i] = data[i * 4 + 1] / 255;
    tensor[2 * planeSize + i] = data[i * 4 + 2] / 255;
  }
  return tensor;
}

export interface PreprocessResult {
  tensor: Float32Array;
  letterboxParams: LetterboxParams;
}

export async function preprocessScreenshot(dataUrl: string, targetSize: number): Promise<PreprocessResult> {
  const bitmap = await dataUrlToImageBitmap(dataUrl);
  try {
    const letterboxParams = computeLetterboxParams(bitmap.width, bitmap.height, targetSize);

    const canvas = new OffscreenCanvas(targetSize, targetSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');

    ctx.fillStyle = `rgb(${LETTERBOX_PAD_RGB},${LETTERBOX_PAD_RGB},${LETTERBOX_PAD_RGB})`;
    ctx.fillRect(0, 0, targetSize, targetSize);

    const scaledW = Math.round(bitmap.width * letterboxParams.scale);
    const scaledH = Math.round(bitmap.height * letterboxParams.scale);
    ctx.drawImage(
      bitmap,
      0,
      0,
      bitmap.width,
      bitmap.height,
      letterboxParams.padLeft,
      letterboxParams.padTop,
      scaledW,
      scaledH,
    );

    const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
    return { tensor: imageDataToNchwTensor(imageData), letterboxParams };
  } finally {
    bitmap.close();
  }
}

export interface VisualDetectionDeps {
  modelManager: VisualModelManager;
  decodeConfig: DecodeConfig;
  sourceModel: string;
}

export async function runVisualDetection(dataUrl: string, deps: VisualDetectionDeps): Promise<VisualSignal[]> {
  if (deps.modelManager.getStatus() !== 'ready') return [];

  try {
    const { tensor, letterboxParams } = await preprocessScreenshot(dataUrl, deps.decodeConfig.inputSize);
    const output = await deps.modelManager.runInference(tensor);
    if (!output) return [];
    return postprocessDetections(output, deps.decodeConfig, letterboxParams, { sourceModel: deps.sourceModel });
  } catch (err) {
    slog.warn({
      module: 'VISUAL_PIPELINE',
      event: 'PREPROCESS_OR_DECODE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
