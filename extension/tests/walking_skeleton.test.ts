import { describe, it, expect, beforeEach } from 'vitest';
import { idRegistry } from '../src/content/id-registry';
import { buildMinimalSanitizedContext } from '../src/background/context-builder';
import type { SanitizedSchema } from '@aegis/protocol';
import type { CaptureResult } from '../src/background/capture';

describe('Phase 2: Walking Skeleton Unit Tests', () => {
  beforeEach(() => {
    idRegistry.reset();
  });

  describe('StableIdRegistry (Work Package B2)', () => {
    it('assigns deterministic IDs without mutating the DOM', () => {
      const div1 = { id: '', attributes: [] } as unknown as Element;
      const div2 = { id: 'search-box', attributes: [] } as unknown as Element;

      const id1 = idRegistry.getOrCreateId(div1);
      const id2 = idRegistry.getOrCreateId(div2);

      expect(id1).toMatch(/^el-\d+$/);
      expect(id2).toBe('el-search-box');

      expect(idRegistry.getOrCreateId(div1)).toBe(id1);
      expect(idRegistry.getOrCreateId(div2)).toBe(id2);

      expect(div1.attributes.length).toBe(0);
    });
  });

  describe('Context Builder & Privacy Boundary (ADR-04 & User Adjustment 1)', () => {
    it('preserves the Sanitized<T> compile-time boundary and redacts sensitive field values', () => {
      const rawSchema: SanitizedSchema = {
        url: 'https://scholarships.gov.in/portal/apply?session_token=SECRET123#step2',
        title: 'Scholarship Application',
        elements: [
          {
            id: 'el-search-input',
            tagName: 'input',
            type: 'text',
            label: 'Search Query',
            value: 'STEM scholarship',
            boundingBox: { x: 10, y: 20, width: 200, height: 30 },
            isVisible: true,
            isDisabled: false,
            isReadOnly: false,
            isInteractive: true,
          },
          {
            id: 'el-password-input',
            tagName: 'input',
            type: 'password',
            label: 'Account Password',
            value: 'SuperSecretPassword!',
            boundingBox: { x: 10, y: 60, width: 200, height: 30 },
            isVisible: true,
            isDisabled: false,
            isReadOnly: false,
            isInteractive: true,
          },
        ],
      };

      const capture: CaptureResult = {
        screenshotDataUrl: 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=',
        format: 'webp',
        dpr: 1.0,
        width: 1280,
        height: 800,
      };

      const sanitizedPayload = buildMinimalSanitizedContext(1, rawSchema, capture, null);

      expect(sanitizedPayload.sanitized_schema.url).toBe('https://scholarships.gov.in/portal/apply');

      expect(sanitizedPayload.sanitized_schema.elements[0].value).toBe('STEM scholarship');

      expect(sanitizedPayload.sanitized_schema.elements[1].value).toBe('[REDACTED_PASSWORD]');
      expect(sanitizedPayload.sanitized_schema.elements[1].value).not.toContain('SuperSecretPassword!');

      expect(sanitizedPayload.step_number).toBe(1);
      expect(sanitizedPayload.screenshot_format).toBe('webp');
    });
  });
});
