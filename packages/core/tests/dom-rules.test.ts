import { describe, it, expect } from 'vitest';
import { analyzeDomElement } from '../src/dom-rules';

describe('DOM Rules D2', () => {
  it('detects type=password', () => {
    const el = {
      id: 'pwd1',
      tagName: 'INPUT',
      type: 'password',
      boundingBox: { x: 0, y: 0, w: 100, h: 20 }
    };
    const signals = analyzeDomElement(el);
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('PASSWORD');
    expect(signals[0].evidence).toBe('type=password');
  });

  it('detects toggled password (type=text, label=password)', () => {
    const el = {
      id: 'pwd2',
      tagName: 'INPUT',
      type: 'text',
      'aria-label': 'Enter your password',
      boundingBox: { x: 0, y: 0, w: 100, h: 20 }
    };
    const signals = analyzeDomElement(el);
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('PASSWORD');
  });

  it('detects autocomplete=cc-number', () => {
    const el = {
      tagName: 'INPUT',
      autocomplete: 'cc-number',
      boundingBox: { x: 0, y: 0, w: 100, h: 20 }
    };
    const signals = analyzeDomElement(el);
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('CARD_NUMBER');
  });

  it('detects Aadhaar by name', () => {
    const el = {
      tagName: 'INPUT',
      name: 'aadhaarNumber',
      boundingBox: { x: 0, y: 0, w: 100, h: 20 }
    };
    const signals = analyzeDomElement(el);
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('AADHAAR');
  });
});
