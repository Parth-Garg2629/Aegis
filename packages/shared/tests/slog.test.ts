import { describe, it, expect, vi } from 'vitest';
import {
  slog,
  filterSafeFields,
  setLogSink,
  markSanitized,
  type SanitizationProof,
} from '../src/index.js';

describe('Safe Structured Logging (slog)', () => {
  it('allows strictly whitelisted fields and discards dangerous arbitrary fields', () => {
    const rawEntry = {
      level: 'info',
      module: 'DOM_EXTRACTOR',
      event: 'EXTRACTION_COMPLETED',
      session_id: 'sess-123',
      step_number: 1,
      duration_ms: 45,
      // Disallowed sensitive fields:
      raw_password: 'superSecretPassword',
      user_aadhaar: '1234 5678 9012',
      inner_html: '<input value="secret"/>',
    };

    const safe = filterSafeFields(rawEntry);
    expect(safe.module).toBe('DOM_EXTRACTOR');
    expect(safe.event).toBe('EXTRACTION_COMPLETED');
    expect(safe.session_id).toBe('sess-123');
    expect(safe.step_number).toBe(1);
    expect(safe.duration_ms).toBe(45);
    expect(safe.timestamp).toBeDefined();

    // Sensitive arbitrary fields must NOT exist in the output
    expect(safe).not.toHaveProperty('raw_password');
    expect(safe).not.toHaveProperty('user_aadhaar');
    expect(safe).not.toHaveProperty('inner_html');
  });

  it('routes through custom sink correctly', () => {
    const sinkFn = vi.fn();
    setLogSink(sinkFn);

    slog.info({
      module: 'TEST_MODULE',
      event: 'TEST_EVENT',
      arbitrary_field: 'should_be_stripped',
    });

    expect(sinkFn).toHaveBeenCalledTimes(1);
    const logged = sinkFn.mock.calls[0][0];
    expect(logged.module).toBe('TEST_MODULE');
    expect(logged.event).toBe('TEST_EVENT');
    expect(logged).not.toHaveProperty('arbitrary_field');
  });
});

describe('Sanitized<T> Compile-Time and Runtime Privacy Boundary', () => {
  it('produces branded Sanitized<T> on valid proof', () => {
    const data = { context: 'clean' };
    const proof: SanitizationProof = {
      verifiedAt: new Date().toISOString(),
      verifier: 'SCHEMA_VERIFIER',
      placeholderCount: 2,
      isRedacted: true,
    };

    const sanitized = markSanitized(data, proof);
    expect(sanitized).toBe(data);
  });

  it('throws when proof indicates invalid or unredacted state', () => {
    const data = { context: 'unclean' };
    const invalidProof: SanitizationProof = {
      verifiedAt: new Date().toISOString(),
      verifier: 'SCHEMA_VERIFIER',
      placeholderCount: 0,
      isRedacted: false,
    };

    expect(() => markSanitized(data, invalidProof)).toThrowError();
  });
});
