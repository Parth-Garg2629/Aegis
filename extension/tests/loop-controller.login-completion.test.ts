import { describe, expect, it } from 'vitest';
import type { SanitizedElement, SanitizedSchema } from '@aegis/protocol';
import { LoopController } from '../src/background/loop-controller';

function element(id: string, overrides: Partial<SanitizedElement> = {}): SanitizedElement {
  return {
    id,
    tagName: 'button',
    label: null,
    text: null,
    value: null,
    boundingBox: { x: 0, y: 0, width: 100, height: 30 },
    isVisible: true,
    isDisabled: false,
    isReadOnly: false,
    isInteractive: true,
    ...overrides,
  };
}

function schema(url: string, elements: SanitizedElement[]): SanitizedSchema {
  return { url, title: 'Login test', elements };
}

describe('login completion detection after an approved action', () => {
  const controller = new LoopController();
  const isCompletedLoginRedirect = (original: SanitizedSchema, current: SanitizedSchema, targetId: string) =>
    (controller as any).isCompletedLoginRedirect(original, current, targetId) as boolean;

  it('recognizes a redirect from a password form to an authenticated feed', () => {
    const original = schema('https://example.test/login', [
      element('password', { tagName: 'input', type: 'password', label: 'Password' }),
      element('submit', { label: 'Sign in' }),
    ]);
    const current = schema('https://example.test/feed', [
      element('profile', { label: 'Profile' }),
      element('messages', { label: 'Messages' }),
    ]);

    expect(isCompletedLoginRedirect(original, current, 'submit')).toBe(true);
  });

  it('does not treat a verification step as completed login', () => {
    const original = schema('https://example.test/login', [
      element('password', { tagName: 'input', type: 'password', label: 'Password' }),
      element('submit', { label: 'Sign in' }),
    ]);
    const current = schema('https://example.test/checkpoint', [
      element('otp', { tagName: 'input', type: 'text', label: 'One-time verification code' }),
      element('continue', { label: 'Continue' }),
    ]);

    expect(isCompletedLoginRedirect(original, current, 'submit')).toBe(false);
  });

  it('does not treat a failed login alert as completed login', () => {
    const original = schema('https://example.test/login', [
      element('password', { tagName: 'input', type: 'password', label: 'Password' }),
      element('submit', { label: 'Sign in' }),
    ]);
    const current = schema('https://example.test/login', [
      element('password', { tagName: 'input', type: 'password', label: 'Password' }),
      element('error', { role: 'alert', text: 'Incorrect password' }),
      element('submit', { label: 'Sign in' }),
    ]);

    expect(isCompletedLoginRedirect(original, current, 'submit')).toBe(false);
  });
});
