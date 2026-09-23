import { describe, it, expect } from 'vitest';
import { denormalizeFaceBox, normalizeFaceSignal, FACE_DETECTION_DISCARD_THRESHOLD } from '../src/face';

describe('denormalizeFaceBox', () => {
  it('scales normalized [0,1] coordinates to screenshot pixel space (§8.3)', () => {
    const box = denormalizeFaceBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 1000, 500);
    expect(box).toEqual({ x: 100, y: 100, w: 300, h: 200 });
  });
});

describe('normalizeFaceSignal', () => {
  it('discards detections below the §8.4 hard floor (0.3)', () => {
    const result = normalizeFaceSignal(
      { boundingBox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.29 },
      1000,
      1000,
    );
    expect(result).toBeNull();
  });

  it('keeps detections at or above the discard threshold, tagged FACE / FACE_DETECTION', () => {
    const result = normalizeFaceSignal(
      { boundingBox: { x: 0.05, y: 0.08, w: 0.1, h: 0.12 }, confidence: FACE_DETECTION_DISCARD_THRESHOLD },
      1000,
      1000,
    );
    expect(result).not.toBeNull();
    expect(result?.category).toBe('FACE');
    expect(result?.source).toBe('FACE_DETECTION');
    expect(result?.elementId).toBeNull();
  });

  it('never leaks raw pixel data — evidence is a fixed safe string (§19.3)', () => {
    const result = normalizeFaceSignal({ boundingBox: { x: 0, y: 0, w: 0.1, h: 0.1 }, confidence: 0.95 }, 1000, 1000);
    expect(result?.evidence).toBe('face_detected');
  });
});
