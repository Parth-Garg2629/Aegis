import { describe, it, expect, vi } from 'vitest';
import { buildSanitizedContext } from '../src/offscreen/privacy-builder';
import type { MinimalSchema } from '@aegis/core';
import type { SensitivityMap } from '@aegis/core';
import { detectPii } from '@aegis/core';

// Mock browser globals
global.fetch = vi.fn().mockResolvedValue({
  blob: () => Promise.resolve(new Blob(['fake'], { type: 'image/png' }))
});
global.createImageBitmap = vi.fn().mockResolvedValue({ width: 800, height: 600 });
global.OffscreenCanvas = class {
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext() { return { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), filter: '' }; }
  convertToBlob() { return Promise.resolve(new Blob(['fake'], { type: 'image/webp' })); }
} as any;
global.FileReader = class {
  onloadend: any;
  result = 'data:image/webp;base64,fake';
  readAsDataURL() { setTimeout(() => this.onloadend(), 0); }
} as any;

describe('Privacy Boundary Integration (D1-D5)', () => {
  it('ensures raw PII never crosses the boundary', async () => {
    // Generate valid mock PII
    // We'll use patterns that would pass detection
    const rawEmail = 'user@example.com';
    const rawPhone = '9876543210';
    const rawPassword = 'mySecretPassword123!';
    
    // Create a schema that contains this PII
    const rawSchema: MinimalSchema = {
      url: 'https://bank.com/account?token=123',
      title: `Account of ${rawEmail}`,
      elements: [
        {
          id: 'pwd1',
          value: rawPassword, // Password
        },
        {
          id: 'phone1',
          value: `My phone is ${rawPhone}`
        }
      ]
    };
    
    // Suppose DOM analysis and heuristics generated this map
    const sensitivityMap: SensitivityMap = {
      regions: [
        {
          regionId: 'r1',
          elementId: 'pwd1',
          category: 'PASSWORD',
          boundingBox: { x: 0, y: 0, w: 10, h: 10 },
          confidence: 1,
          failSafe: false,
          sanitizationAction: 'BLUR_AND_REPLACE',
          sources: ['DOM_ANALYSIS']
        }
      ]
    };
    
    const context = await buildSanitizedContext({
      rawDataUrl: 'data:image/png;base64,raw',
      rawSchema,
      sensitivityMap,
      dpr: 1,
      strictMode: true,
      stepNumber: 1,
      agentState: 'running',
      previousActionResult: null
    });

    const payloadJson = JSON.stringify(context);
    
    // Assert raw values NEVER appear in the payload string
    expect(payloadJson).not.toContain(rawEmail);
    expect(payloadJson).not.toContain(rawPhone);
    expect(payloadJson).not.toContain(rawPassword);
    expect(payloadJson).not.toContain('token=123'); // URL should be stripped
    expect(payloadJson).not.toContain('data:image/png;base64,raw'); // Raw screenshot should be gone
    
    // Assert placeholders are present
    expect(payloadJson).toContain('[REDACTED_EMAIL]');
    expect(payloadJson).toContain('[REDACTED_PHONE]');
    expect(payloadJson).toContain('[REDACTED_PASSWORD]');
  });
});
