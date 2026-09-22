/**
 * AEGIS Minimal Walking-Skeleton Context Builder & Sanitizer Path
 * Source of Truth: docs/TECHNICAL_SPEC.md §10.4, docs/SECURITY_PRIVACY.md §4
 *
 * Implements the minimal walking-skeleton Context Builder/Sanitizer path
 * while strictly preserving the Sanitized<T> compile-time / privacy boundary (ADR-04).
 * Full on-device ML perception and multi-modal redaction are implemented in later C/D phases.
 */
import type { ContextUpdatePayload, PreviousActionResult, SanitizedSchema } from '@aegis/protocol';
import { type Sanitized } from '@aegis/shared';
import type { CaptureResult } from './capture';
export declare function buildMinimalSanitizedContext(stepNumber: number, rawSchema: SanitizedSchema, capture: CaptureResult, previousResult?: PreviousActionResult | null): Sanitized<ContextUpdatePayload>;
//# sourceMappingURL=context-builder.d.ts.map