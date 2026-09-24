import type { SensitivityMap } from '../types';
import { detectPii } from '../heuristics';

// Locally defined to avoid dependency on @aegis/protocol inside core
export interface MinimalSchemaElement {
  id: string;
  label?: string | null;
  text?: string | null;
  value?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface MinimalSchema {
  url: string;
  title: string;
  elements: MinimalSchemaElement[];
  [key: string]: any; // Allow other fields like forms
}

export interface VerificationResult {
  clean: boolean;
  defectCount: number;
  fieldPaths: string[];
}

function redactString(text: string): string {
  if (!text) return text;
  let sanitized = text;
  const piiResults = detectPii(text);
  
  // Replace back to front
  const sortedPii = [...piiResults].sort((a, b) => b.span.start - a.span.start);
  for (const res of sortedPii) {
    const placeholder = `[REDACTED_${res.category}]`;
    sanitized = sanitized.substring(0, res.span.start) + placeholder + sanitized.substring(res.span.end);
  }
  return sanitized;
}

export function sanitizeSchema<T extends MinimalSchema>(schema: T, sensitivityMap: SensitivityMap): T {
  // Deep clone to avoid mutating the original
  const sanitized: T = JSON.parse(JSON.stringify(schema));
  
  // 1. URL: Origin + pathname only
  try {
    const urlObj = new URL(sanitized.url);
    sanitized.url = urlObj.origin + urlObj.pathname;
  } catch (e) {
    // If not a valid URL, just leave it or empty it. For now, leave it.
  }
  
  // 2. Title
  if (sanitized.title) {
    sanitized.title = redactString(sanitized.title);
  }
  
  // Pre-calculate which element IDs are in the sensitivity map
  const sensitiveElementIds = new Map<string, string>(); // id -> category
  for (const region of sensitivityMap.regions) {
    if (region.elementId) {
      sensitiveElementIds.set(region.elementId, region.category);
    }
  }

  // 3. Elements
  if (Array.isArray(sanitized.elements)) {
    for (const el of sanitized.elements) {
      // a. label
      if (el.label) {
        el.label = redactString(el.label);
      }
      
      // b. text
      if (el.text) {
        el.text = redactString(el.text);
      }
      
      // c. value
      if (el.value) {
        const sensitiveCategory = sensitiveElementIds.get(el.id);
        if (sensitiveCategory) {
           // Value belongs to a flagged region. We replace the ENTIRE value.
           el.value = `[REDACTED_${sensitiveCategory}]`;
        } else {
           // Even if not flagged by DOM rules, we run heuristics on the value just in case
           el.value = redactString(el.value);
        }
      }
      
      // d. attributes
      if (el.attributes) {
        for (const [key, val] of Object.entries(el.attributes)) {
          if (typeof val === 'string') {
            el.attributes[key] = redactString(val);
          }
        }
      }
    }
  }
  
  // 4. Ensure forbidden fields are stripped
  delete (sanitized as any).sensitivityMap;
  delete (sanitized as any).cookies;
  delete (sanitized as any).tokens;
  
  return sanitized;
}

export function verifySchema(schema: MinimalSchema): VerificationResult {
  const result: VerificationResult = {
    clean: true,
    defectCount: 0,
    fieldPaths: []
  };

  function checkString(text: string, path: string) {
    if (!text) return;
    const piiResults = detectPii(text);
    if (piiResults.length > 0) {
      result.clean = false;
      result.defectCount += piiResults.length;
      result.fieldPaths.push(path);
    }
  }

  checkString(schema.title, 'title');
  checkString(schema.url, 'url');

  if (Array.isArray(schema.elements)) {
    schema.elements.forEach((el, idx) => {
      checkString(el.label || '', `elements[${idx}].label`);
      checkString(el.text || '', `elements[${idx}].text`);
      checkString(el.value || '', `elements[${idx}].value`);
      
      if (el.attributes) {
        for (const [key, val] of Object.entries(el.attributes)) {
          if (typeof val === 'string') {
            checkString(val, `elements[${idx}].attributes.${key}`);
          }
        }
      }
    });
  }

  return result;
}
