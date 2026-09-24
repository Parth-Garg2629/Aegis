import { describe, it, expect } from 'vitest';
import { scanGoal } from '../src/goal-scanner';

describe('Goal Scanner D6', () => {
  it('detects and scrubs phone number', () => {
    const res = scanGoal('Call +91 9876543210 please');
    expect(res.hasSensitiveContent).toBe(true);
    expect(res.sanitizedGoal).toBe('Call [REDACTED_PHONE] please');
    expect(res.categories).toContain('PHONE');
  });

  it('detects and scrubs email', () => {
    const res = scanGoal('Email to test@example.com');
    expect(res.sanitizedGoal).toBe('Email to [REDACTED_EMAIL]');
    expect(res.categories).toContain('EMAIL');
  });

  it('passes through clean goal', () => {
    const res = scanGoal('Click the next button');
    expect(res.hasSensitiveContent).toBe(false);
    expect(res.sanitizedGoal).toBe('Click the next button');
  });

  it('detects risk keywords and warns but does not scrub them', () => {
    const res = scanGoal('Please delete this item');
    expect(res.hasSensitiveContent).toBe(true); 
    expect(res.sanitizedGoal).toBe('Please delete this item'); // Does not redact the word delete
  });
});
