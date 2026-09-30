import { describe, expect, it } from 'vitest';
import { captureFailureCode } from '../src/background/capture-error';

describe('screenshot capture failures', () => {
  it('reports the missing activeTab grant with a specific error code', () => {
    expect(captureFailureCode(new Error("Either the '<all_urls>' or 'activeTab' permission is required.")))
      .toBe('E-CAPTURE-PERMISSION');
  });

  it('keeps other capture failures distinct from permission failures', () => {
    expect(captureFailureCode(new Error('captureVisibleTab failed'))).toBe('E-CAPTURE-UNAVAILABLE');
  });
});
