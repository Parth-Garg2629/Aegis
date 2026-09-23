import type {
  ContextUpdatePayload,
  PreviousActionResult,
  SanitizedElement,
  SanitizedSchema,
} from '@aegis/protocol';
import { markSanitized, type Sanitized, type SanitizationProof } from '@aegis/shared';
import type { CaptureResult } from './capture';

export function buildMinimalSanitizedContext(
  stepNumber: number,
  rawSchema: SanitizedSchema,
  capture: CaptureResult,
  previousResult: PreviousActionResult | null = null,
): Sanitized<ContextUpdatePayload> {
  let redactedCount = 0;

  let cleanUrl = rawSchema.url;
  try {
    const parsed = new URL(rawSchema.url);
    cleanUrl = `${parsed.origin}${parsed.pathname}`;
  } catch {
    cleanUrl = rawSchema.url.split('?')[0].split('#')[0];
  }

  const sanitizedElements: SanitizedElement[] = rawSchema.elements.map((el) => {
    let sanitizedValue = el.value;

    const isSensitive =
      el.type === 'password' ||
      (el.label && /password|pin|cvv|otp|aadhaar/i.test(el.label)) ||
      (el.text && /password|pin|cvv|otp/i.test(el.text));

    if (isSensitive) {
      sanitizedValue = '[REDACTED_PASSWORD]';
      redactedCount++;
    }

    return {
      ...el,
      value: sanitizedValue,
    };
  });

  const sanitizedSchema: SanitizedSchema = {
    url: cleanUrl,
    title: rawSchema.title,
    elements: sanitizedElements,
    forms: rawSchema.forms,
  };

  const payload: ContextUpdatePayload = {
    step_number: stepNumber,
    agent_state: 'running',
    sanitized_screenshot: capture.screenshotDataUrl,
    screenshot_format: capture.format || 'webp',
    sanitized_schema: sanitizedSchema,
    previous_action_result: previousResult,
  };

  const proof: SanitizationProof = {
    verifiedAt: new Date().toISOString(),
    verifier: 'walking-skeleton-minimal-sanitizer',
    placeholderCount: redactedCount,
    isRedacted: true,
  };

  return markSanitized(payload, proof);
}
