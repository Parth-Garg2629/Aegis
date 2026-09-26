import type { ContextUpdatePayload, PreviousActionResult, SanitizedSchema } from '@aegis/protocol';
import { type Sanitized } from '@aegis/shared';
import type { CaptureResult } from './capture';
export declare function buildMinimalSanitizedContext(stepNumber: number, rawSchema: SanitizedSchema, capture: CaptureResult, previousResult?: PreviousActionResult | null): Sanitized<ContextUpdatePayload>;
//# sourceMappingURL=context-builder.d.ts.map