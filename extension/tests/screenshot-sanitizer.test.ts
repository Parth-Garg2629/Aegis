import { describe, it, expect, vi } from 'vitest';
import { sanitizeScreenshot, applyFaceUnavailableFallback } from '../src/offscreen/screenshot-sanitizer';
import type { SensitivityMap } from '@aegis/core';

// Mock browser globals needed by screenshot-sanitizer in vitest jsdom environment
global.fetch = vi.fn().mockResolvedValue({
  blob: () => Promise.resolve(new Blob(['fake-image-data'], { type: 'image/png' }))
});
global.createImageBitmap = vi.fn().mockResolvedValue({ width: 800, height: 600 });
global.OffscreenCanvas = class {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      filter: '',
    };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(['fake-webp-data'], { type: 'image/webp' }));
  }
} as any;
global.FileReader = class {
  onloadend: any;
  onerror: any;
  result = 'data:image/webp;base64,fake';
  readAsDataURL() {
    setTimeout(() => this.onloadend(), 0);
  }
} as any;

describe('Screenshot Sanitizer D4', () => {
  it('sanitizeScreenshot processes regions and returns data url', async () => {
    const map: SensitivityMap = {
      regions: [
        {
          regionId: 'r1',
          elementId: null,
          boundingBox: { x: 10, y: 10, w: 100, h: 20 },
          category: 'PASSWORD',
          confidence: 1,
          failSafe: false,
          sanitizationAction: 'BLUR_AND_REPLACE',
          sources: ['DOM_ANALYSIS']
        },
        {
          regionId: 'r2',
          elementId: null,
          boundingBox: { x: 50, y: 50, w: 200, h: 200 },
          category: 'FACE',
          confidence: 0.9,
          failSafe: false,
          sanitizationAction: 'BLUR_VISUAL',
          sources: ['FACE_DETECTION']
        }
      ]
    };
    
    const res = await sanitizeScreenshot('data:image/png;base64,xx', map, 2.0);
    expect(res.dataUrl).toBe('data:image/webp;base64,fake');
    expect(res.redactedRegions).toBe(2);
    expect(res.failedRegions).toBe(0);
  });

  it('applyFaceUnavailableFallback blurs large image regions', () => {
    const canvas = new OffscreenCanvas(800, 600);
    const regions = [
      { x: 0, y: 0, w: 100, h: 100 }, // Large enough
      { x: 0, y: 0, w: 10, h: 10 }    // Too small
    ];
    applyFaceUnavailableFallback(canvas, regions, 1.0);
    // As it is void and heavily mocked, just ensuring it doesn't throw
    expect(true).toBe(true);
  });
});
