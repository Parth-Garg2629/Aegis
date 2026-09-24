import { describe, it, expect } from 'vitest';
import {
  computeLetterboxParams,
  inverseTransformBox,
  decodeGridOutput,
  nonMaxSuppression,
  postprocessDetections,
  normalizeVisualSignal,
  type DecodeConfig,
} from '../src/visual';
import type { UIElementClass } from '../src/types';

describe('letterbox geometry', () => {
  it('computes scale/padding for a wider-than-tall image (landscape)', () => {
    const params = computeLetterboxParams(1280, 720, 320);
    expect(params.scale).toBeCloseTo(0.25);
    expect(params.padLeft).toBe(0);
    expect(params.padTop).toBe(70);
  });

  it('round-trips a box through forward+inverse transform', () => {
    const params = computeLetterboxParams(1280, 720, 320);
    const original = { x: 100, y: 100, w: 200, h: 50 };
    const modelSpace = {
      x: original.x * params.scale + params.padLeft,
      y: original.y * params.scale + params.padTop,
      w: original.w * params.scale,
      h: original.h * params.scale,
    };
    const recovered = inverseTransformBox(modelSpace, params);
    expect(recovered.x).toBeCloseTo(original.x, 0);
    expect(recovered.y).toBeCloseTo(original.y, 0);
    expect(recovered.w).toBeCloseTo(original.w, 0);
    expect(recovered.h).toBeCloseTo(original.h, 0);
  });

  it('clamps out-of-bounds boxes to the original image dimensions (§13.2)', () => {
    const params = computeLetterboxParams(100, 100, 320);
    const oob = inverseTransformBox({ x: -50, y: -50, w: 1000, h: 1000 }, params);
    expect(oob.x).toBeGreaterThanOrEqual(0);
    expect(oob.y).toBeGreaterThanOrEqual(0);
    expect(oob.x + oob.w).toBeLessThanOrEqual(params.srcWidth + 1e-6);
    expect(oob.y + oob.h).toBeLessThanOrEqual(params.srcHeight + 1e-6);
  });
});

describe('nonMaxSuppression', () => {
  it('suppresses a lower-confidence duplicate of the same class', () => {
    const results = nonMaxSuppression(
      [
        { box: { x: 0, y: 0, w: 10, h: 10 }, confidence: 0.9, classId: 0 },
        { box: { x: 1, y: 1, w: 10, h: 10 }, confidence: 0.5, classId: 0 },
      ],
      0.45,
      100,
    );
    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe(0.9);
  });

  it('keeps overlapping detections of different classes', () => {
    const results = nonMaxSuppression(
      [
        { box: { x: 0, y: 0, w: 10, h: 10 }, confidence: 0.9, classId: 0 },
        { box: { x: 1, y: 1, w: 10, h: 10 }, confidence: 0.8, classId: 1 },
      ],
      0.45,
      100,
    );
    expect(results).toHaveLength(2);
  });

  it('respects maxDetections', () => {
    const dets = Array.from({ length: 10 }, (_, i) => ({
      box: { x: i * 100, y: 0, w: 10, h: 10 },
      confidence: 1 - i * 0.01,
      classId: 0,
    }));
    expect(nonMaxSuppression(dets, 0.45, 3)).toHaveLength(3);
  });
});

describe('decodeGridOutput', () => {
  const CLASS_NAMES: readonly UIElementClass[] = ['button', 'input_field'];
  const config: DecodeConfig = {
    gridSize: 2,
    inputSize: 320,
    numClasses: CLASS_NAMES.length,
    classNames: CLASS_NAMES,
    confidenceThreshold: 0.4,
  };

  function buildOutput(cells: Record<number, { objLogit: number; classLogits: number[]; box: number[] }>) {
    const channelsPerCell = 5 + CLASS_NAMES.length;
    const out = new Float32Array(config.gridSize * config.gridSize * channelsPerCell);
    for (const [idxStr, cell] of Object.entries(cells)) {
      const idx = Number(idxStr);
      const base = idx * channelsPerCell;
      out[base] = cell.objLogit;
      cell.classLogits.forEach((l, c) => (out[base + 1 + c] = l));
      cell.box.forEach((v, i) => (out[base + 1 + CLASS_NAMES.length + i] = v));
    }
    return out;
  }

  it('throws on a malformed tensor length', () => {
    expect(() => decodeGridOutput(new Float32Array(3), config)).toThrow();
  });

  it('produces no detections when objectness is very low everywhere', () => {
    const out = buildOutput({});
    expect(decodeGridOutput(out, config)).toHaveLength(0);
  });

  it('decodes a strong detection at a known grid cell into the expected region', () => {
    const out = buildOutput({
      3: { objLogit: 10, classLogits: [10, -10], box: [0, 0, 0, 0] },
    });
    const detections = decodeGridOutput(out, config);
    expect(detections).toHaveLength(1);
    const d = detections[0];
    expect(d.classId).toBe(0);
    expect(d.confidence).toBeGreaterThan(0.9);
    expect(d.box.x).toBeCloseTo(160, 0);
    expect(d.box.w).toBeCloseTo(160, 0);
  });
});

describe('postprocessDetections + normalizeVisualSignal end-to-end', () => {
  it('produces a VisualSignal in original screenshot space, then a UI_ELEMENT NormalizedSignal', () => {
    const CLASS_NAMES: readonly UIElementClass[] = ['button'];
    const decodeConfig: DecodeConfig = {
      gridSize: 1,
      inputSize: 320,
      numClasses: 1,
      classNames: CLASS_NAMES,
      confidenceThreshold: 0.4,
    };
    const channelsPerCell = 5 + 1;
    const out = new Float32Array(channelsPerCell);
    out[0] = 10;
    out[1] = 10;
    out[2] = 0; out[3] = 0; out[4] = 0; out[5] = 0;

    const letterboxParams = computeLetterboxParams(1280, 720, 320);
    const signals = postprocessDetections(out, decodeConfig, letterboxParams, { sourceModel: 'aegis-nano-test' });

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('button');
    expect(signals[0].boundingBox.x).toBeGreaterThanOrEqual(0);
    expect(signals[0].boundingBox.x + signals[0].boundingBox.w).toBeLessThanOrEqual(1280 + 1e-6);

    const normalized = normalizeVisualSignal(signals[0]);
    expect(normalized.source).toBe('VISUAL_ML');
    expect(normalized.category).toBe('UI_ELEMENT');
    expect(normalized.elementId).toBeNull();
  });
});
