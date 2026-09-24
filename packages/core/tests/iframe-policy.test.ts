import { describe, it, expect } from 'vitest';
import { getIframeSensitivityRegions } from '../src/iframe-policy';

describe('Iframe Policy D7', () => {
  it('emits GENERIC_PII signals for iframes when policy is blur', () => {
    const elements = [
      { id: 'if1', tagName: 'IFRAME', boundingBox: { x: 0, y: 0, w: 300, h: 250 } },
      { id: 'div1', tagName: 'DIV', boundingBox: { x: 0, y: 0, w: 100, h: 100 } }
    ];
    
    const signals = getIframeSensitivityRegions(elements, 'blur');
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('GENERIC_PII');
    expect(signals[0].elementId).toBe('if1');
  });

  it('emits no signals when policy is pass', () => {
    const elements = [
      { id: 'if1', tagName: 'IFRAME', boundingBox: { x: 0, y: 0, w: 300, h: 250 } }
    ];
    
    const signals = getIframeSensitivityRegions(elements, 'pass');
    expect(signals).toHaveLength(0);
  });
});
