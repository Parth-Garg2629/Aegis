import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  fuseSignals,
  computeIoU,
  higherPriorityCategory,
  mapCategoryToSanitizationAction,
  DEFAULT_FUSION_CONFIG,
  type FusionInput,
} from '../src/fusion';
import type { DomElementRef, NormalizedSignal, Rect } from '../src/types';

function signal(overrides: Partial<NormalizedSignal>): NormalizedSignal {
  return {
    signalId: 'sig-1',
    source: 'HEURISTIC_PII',
    elementId: null,
    boundingBox: { x: 0, y: 0, w: 10, h: 10 },
    category: 'GENERIC_PII',
    confidence: 1.0,
    evidence: 'test',
    ...overrides,
  };
}

const emptyInput: FusionInput = {
  domSignals: [],
  visualSignals: [],
  faceSignals: [],
  piiSignals: [],
};

describe('geometry: computeIoU', () => {
  it('is 0 for disjoint rects', () => {
    expect(computeIoU({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 10, h: 10 })).toBe(0);
  });

  it('is 1 for identical rects', () => {
    const r: Rect = { x: 5, y: 5, w: 20, h: 20 };
    expect(computeIoU(r, r)).toBeCloseTo(1.0);
  });

  it('computes partial overlap correctly', () => {
    const a: Rect = { x: 0, y: 0, w: 10, h: 10 };
    const b: Rect = { x: 5, y: 0, w: 10, h: 10 };
    expect(computeIoU(a, b)).toBeCloseTo(50 / 150);
  });
});

describe('priority mapping (§11.5, §11.6)', () => {
  it('PASSWORD outranks EMAIL', () => {
    expect(higherPriorityCategory('PASSWORD', 'EMAIL')).toBe('PASSWORD');
  });

  it('AADHAAR outranks FACE', () => {
    expect(higherPriorityCategory('AADHAAR', 'FACE')).toBe('AADHAAR');
  });

  it('FACE maps to BLUR_VISUAL only; PII categories map to BLUR_AND_REPLACE', () => {
    expect(mapCategoryToSanitizationAction('FACE')).toBe('BLUR_VISUAL');
    expect(mapCategoryToSanitizationAction('PASSWORD')).toBe('BLUR_AND_REPLACE');
    expect(mapCategoryToSanitizationAction('AADHAAR')).toBe('BLUR_AND_REPLACE');
    expect(mapCategoryToSanitizationAction('GENERIC_PII')).toBe('BLUR_AND_REPLACE');
  });
});

describe('fuseSignals — core algorithm', () => {
  it('excludes UI_ELEMENT signals from the sensitivity map entirely', () => {
    const input: FusionInput = {
      ...emptyInput,
      visualSignals: [
        signal({ source: 'VISUAL_ML', category: 'UI_ELEMENT', confidence: 0.95 }),
      ],
    };
    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions).toHaveLength(0);
  });

  it('§11.7 FAIL-SAFE INVARIANT: a low-confidence non-UI signal is still included, flagged failSafe', () => {
    const input: FusionInput = {
      ...emptyInput,
      piiSignals: [
        signal({ source: 'HEURISTIC_PII', category: 'CARD_NUMBER', confidence: 0.2 }),
      ],
    };
    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions).toHaveLength(1);
    expect(map.regions[0].failSafe).toBe(true);
    expect(map.regions[0].category).toBe('CARD_NUMBER');
    expect(map.regions[0].sanitizationAction).toBe('BLUR_AND_REPLACE');
  });

  it('a high-confidence signal is included without the failSafe flag', () => {
    const input: FusionInput = {
      ...emptyInput,
      domSignals: [signal({ source: 'DOM_ANALYSIS', category: 'PASSWORD', confidence: 1.0 })],
    };
    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions[0].failSafe).toBe(false);
  });

  it('merges overlapping signals from different sources, keeping the higher-priority category', () => {
    const box: Rect = { x: 100, y: 100, w: 200, h: 30 };
    const input: FusionInput = {
      domSignals: [],
      visualSignals: [],
      faceSignals: [],
      piiSignals: [
        signal({ source: 'HEURISTIC_PII', category: 'AADHAAR', confidence: 1.0, boundingBox: box, elementId: 'el-17' }),
      ],
    };
    input.domSignals.push(
      signal({ source: 'DOM_ANALYSIS', category: 'EMAIL', confidence: 1.0, boundingBox: { ...box, w: 205 } }),
    );

    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions).toHaveLength(1);
    expect(map.regions[0].category).toBe('AADHAAR');
    expect(map.regions[0].sources.sort()).toEqual(['DOM_ANALYSIS', 'HEURISTIC_PII']);
    expect(map.regions[0].elementId).toBe('el-17');
  });

  it('does not merge non-overlapping signals', () => {
    const input: FusionInput = {
      ...emptyInput,
      piiSignals: [
        signal({ boundingBox: { x: 0, y: 0, w: 10, h: 10 }, category: 'EMAIL' }),
        signal({ boundingBox: { x: 500, y: 500, w: 10, h: 10 }, category: 'PHONE' }),
      ],
    };
    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions).toHaveLength(2);
  });

  it('associates a signal with no elementId to the nearest overlapping DOM element (§11.8)', () => {
    const domElements: DomElementRef[] = [
      { elementId: 'el-42', boundingBox: { x: 50, y: 80, w: 100, h: 120 } },
    ];
    const input: FusionInput = {
      ...emptyInput,
      faceSignals: [
        signal({ source: 'FACE_DETECTION', category: 'FACE', confidence: 0.92, elementId: null, boundingBox: { x: 55, y: 85, w: 90, h: 110 } }),
      ],
    };
    const map = fuseSignals(input, domElements, { w: 1280, h: 720 }, 0);
    expect(map.regions[0].elementId).toBe('el-42');
  });

  it('leaves elementId null when no DOM element overlaps sufficiently (§11.8)', () => {
    const domElements: DomElementRef[] = [
      { elementId: 'el-far-away', boundingBox: { x: 900, y: 900, w: 10, h: 10 } },
    ];
    const input: FusionInput = {
      ...emptyInput,
      faceSignals: [signal({ source: 'FACE_DETECTION', category: 'FACE', confidence: 0.9, elementId: null })],
    };
    const map = fuseSignals(input, domElements, { w: 1280, h: 720 }, 0);
    expect(map.regions[0].elementId).toBeNull();
  });

  it('produces a stable, sorted regionId ordering regardless of input order', () => {
    const input: FusionInput = {
      ...emptyInput,
      piiSignals: [
        signal({ boundingBox: { x: 0, y: 200, w: 10, h: 10 } }),
        signal({ boundingBox: { x: 0, y: 0, w: 10, h: 10 } }),
      ],
    };
    const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);
    expect(map.regions[0].boundingBox.y).toBe(0);
    expect(map.regions[1].boundingBox.y).toBe(200);
    expect(map.regions[0].regionId).toBe('r-001');
    expect(map.regions[1].regionId).toBe('r-002');
  });
});

describe('fuseSignals — property-based (fast-check)', () => {
  const categoryArb = fc.constantFrom(
    'FACE', 'PASSWORD', 'OTP', 'AADHAAR', 'PAN', 'CARD_NUMBER', 'EMAIL', 'PHONE', 'GENERIC_PII',
  ) as fc.Arbitrary<NormalizedSignal['category']>;
  const sourceArb = fc.constantFrom(
    'DOM_ANALYSIS', 'VISUAL_ML', 'FACE_DETECTION', 'HEURISTIC_PII',
  ) as fc.Arbitrary<NormalizedSignal['source']>;

  const signalArb: fc.Arbitrary<NormalizedSignal> = fc.record({
    signalId: fc.uuid(),
    source: sourceArb,
    elementId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: null }),
    boundingBox: fc.record({
      x: fc.integer({ min: 0, max: 1000 }),
      y: fc.integer({ min: 0, max: 1000 }),
      w: fc.integer({ min: 1, max: 300 }),
      h: fc.integer({ min: 1, max: 300 }),
    }),
    category: categoryArb,
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
    evidence: fc.constant('fuzz'),
  });

  it('is deterministic: identical input always yields an identical SensitivityMap', () => {
    fc.assert(
      fc.property(fc.array(signalArb, { maxLength: 12 }), (signals) => {
        const input: FusionInput = { domSignals: [], visualSignals: [], faceSignals: [], piiSignals: signals };
        const mapA = fuseSignals(input, [], { w: 1280, h: 720 }, 12345);
        const mapB = fuseSignals(input, [], { w: 1280, h: 720 }, 12345);
        expect(mapB).toEqual(mapA);
      }),
      { numRuns: 200 },
    );
  });

  it('fail-safe invariant holds for arbitrary signals: every non-UI signal below threshold survives with failSafe=true', () => {
    fc.assert(
      fc.property(fc.array(signalArb, { minLength: 1, maxLength: 8 }), (signals) => {
        const input: FusionInput = { domSignals: [], visualSignals: [], faceSignals: [], piiSignals: signals };
        const map = fuseSignals(input, [], { w: 1280, h: 720 }, 0);

        for (const s of signals) {
          const covered = map.regions.some(
            (r) => computeIoU(r.boundingBox, s.boundingBox) > 0 || (r.boundingBox.x === s.boundingBox.x && r.boundingBox.y === s.boundingBox.y),
          );
          expect(covered).toBe(true);
        }

        for (const region of map.regions) {
          expect(region.confidence).toBeGreaterThanOrEqual(0);
          expect(region.confidence).toBeLessThanOrEqual(1);
          if (region.confidence < DEFAULT_FUSION_CONFIG.minimumConfidenceThreshold) {
            expect(region.failSafe).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
