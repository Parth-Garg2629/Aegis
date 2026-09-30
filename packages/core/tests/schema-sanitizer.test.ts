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

  it('redacts retained labels and drops unneeded page-authored attributes', () => {
    const schema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Contact test@example.com',
      elements: [{
        id: '1',
        attributes: {
          'aria-label': 'Phone: +91 9876543210',
          value: 'unredacted@example.com',
          'data-secret': 'private token'
        }
      }]
    };
    const sensitivityMap: SensitivityMap = { regions: [] };
    
    const sanitized = sanitizeSchema(schema, sensitivityMap);
    expect(sanitized.title).toBe('Contact [REDACTED_EMAIL]');
    expect(sanitized.elements[0].attributes!['aria-label']).toBe('Phone: [REDACTED_PHONE]');
    expect(sanitized.elements[0].attributes!['value']).toBeUndefined();
    expect(sanitized.elements[0].attributes!['data-secret']).toBeUndefined();
  });

  it('minimizes form destinations and drops unexpected schema fields', () => {
    const schema = {
      url: 'https://example.com/form?token=secret',
      title: 'Form',
      elements: [],
      forms: [{ id: 'f-1', action: 'https://example.com/submit?session=secret', method: 'POST', elementIds: [] }],
      cookies: 'private-cookie',
    } as unknown as MinimalSchema;
    const sanitized = sanitizeSchema(schema, { regions: [] });
    expect(sanitized.forms).toEqual([{ id: 'f-1', action: 'https://example.com', method: 'POST', elementIds: [] }]);
    expect((sanitized as any).cookies).toBeUndefined();
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

  it('verifySchema checks nested form and attribute strings', () => {
    const schema: MinimalSchema = {
      url: 'https://example.com',
      title: 'Clean',
      elements: [{ id: 'el-0', attributes: { placeholder: 'Contact test@example.com' } }],
      forms: [{ id: 'f-0', action: 'https://example.com/test@example.com', method: 'GET', elementIds: [] }],
    };
    const result = verifySchema(schema);
    expect(result.clean).toBe(false);
    expect(result.fieldPaths).toContain('elements[0].attributes.placeholder');
    expect(result.fieldPaths).toContain('forms[0].action');
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
