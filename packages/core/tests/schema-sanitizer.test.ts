import { describe, it, expect } from 'vitest';
import { sanitizeSchema, verifySchema, type MinimalSchema } from '../src/schema-sanitizer';
import type { SensitivityMap } from '../src/types';

describe('Schema Sanitizer D3', () => {
  it('strips query strings and fragments from URL', () => {
    const schema: MinimalSchema = {
      url: 'https://example.com/path?query=123#frag',
      title: 'Title',
      elements: []
    };
    const sensitivityMap: SensitivityMap = { regions: [] };
    
    const sanitized = sanitizeSchema(schema, sensitivityMap);
    expect(sanitized.url).toBe('https://example.com/path');
  });

  it('redacts PII from title and attributes', () => {
    const schema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Contact test@example.com',
      elements: [{
        id: '1',
        attributes: {
          'data-info': 'Phone: +91 9876543210'
        }
      }]
    };
    const sensitivityMap: SensitivityMap = { regions: [] };
    
    const sanitized = sanitizeSchema(schema, sensitivityMap);
    expect(sanitized.title).toBe('Contact [REDACTED_EMAIL]');
    expect(sanitized.elements[0].attributes!['data-info']).toBe('Phone: [REDACTED_PHONE]');
  });

  it('redacts the entire element value if its ID is in the sensitivity map', () => {
    const schema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Title',
      elements: [{
        id: 'pwd1',
        value: 'mySuperSecretPassword123'
      }]
    };
    const sensitivityMap: SensitivityMap = { 
      regions: [
        {
          regionId: 'r1',
          elementId: 'pwd1',
          category: 'PASSWORD',
          boundingBox: { x: 0, y: 0, w: 10, h: 10 },
          confidence: 1.0,
          failSafe: false,
          sanitizationAction: 'BLUR_AND_REPLACE',
          sources: ['DOM_ANALYSIS']
        }
      ] 
    };
    
    const sanitized = sanitizeSchema(schema, sensitivityMap);
    expect(sanitized.elements[0].value).toBe('[REDACTED_PASSWORD]');
  });

  it('verifySchema identifies surviving PII', () => {
    // Intentionally bypass sanitizer by putting raw PII in an un-sanitized schema
    const rawSchema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Surviving email: unredacted@example.com',
      elements: []
    };
    
    const result = verifySchema(rawSchema);
    expect(result.clean).toBe(false);
    expect(result.defectCount).toBe(1);
    expect(result.fieldPaths).toContain('title');
  });

  it('verifySchema passes clean schema', () => {
    const cleanSchema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Clean [REDACTED_EMAIL]',
      elements: []
    };
    
    const result = verifySchema(cleanSchema);
    expect(result.clean).toBe(true);
    expect(result.defectCount).toBe(0);
  });
});
