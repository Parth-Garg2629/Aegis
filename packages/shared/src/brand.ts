/**
 * Compile-Time Privacy Boundary (ADR-04)
 * Only the sanitizer/context-builder modules may produce Sanitized<T>.
 */

declare const SANITIZED: unique symbol;

export type Sanitized<T> = T & { readonly [SANITIZED]: true };

export interface SanitizationProof {
  readonly verifiedAt: string;
  readonly verifier: string;
  readonly placeholderCount: number;
  readonly isRedacted: boolean;
}

/**
 * Marks a payload as Sanitized after proof verification.
 * The WebSocket client must only accept Sanitized<T> for transmission.
 */
export function markSanitized<T>(value: T, proof: SanitizationProof): Sanitized<T> {
  if (!proof || typeof proof.verifiedAt !== 'string' || !proof.isRedacted) {
    throw new Error('Invalid sanitization proof: payload cannot be certified as sanitized');
  }
  return value as Sanitized<T>;
}
