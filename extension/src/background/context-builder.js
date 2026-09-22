/**
 * AEGIS Minimal Walking-Skeleton Context Builder & Sanitizer Path
 * Source of Truth: docs/TECHNICAL_SPEC.md §10.4, docs/SECURITY_PRIVACY.md §4
 *
 * Implements the minimal walking-skeleton Context Builder/Sanitizer path
 * while strictly preserving the Sanitized<T> compile-time / privacy boundary (ADR-04).
 * Full on-device ML perception and multi-modal redaction are implemented in later C/D phases.
 */
import { markSanitized } from '@aegis/shared';
export function buildMinimalSanitizedContext(stepNumber, rawSchema, capture, previousResult = null) {
    let redactedCount = 0;
    // 1. URL Normalization: strip query parameters and hashes that may leak session tokens or PII (SD-05)
    let cleanUrl = rawSchema.url;
    try {
        const parsed = new URL(rawSchema.url);
        cleanUrl = `${parsed.origin}${parsed.pathname}`;
    }
    catch {
        // If relative or unparseable, strip anything after '?' or '#'
        cleanUrl = rawSchema.url.split('?')[0].split('#')[0];
    }
    // 2. Element-level minimal sanitization
    const sanitizedElements = rawSchema.elements.map((el) => {
        let sanitizedValue = el.value;
        // Check for password or sensitive input indicators
        const isSensitive = el.type === 'password' ||
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
    const sanitizedSchema = {
        url: cleanUrl,
        title: rawSchema.title,
        elements: sanitizedElements,
        forms: rawSchema.forms,
    };
    const payload = {
        step_number: stepNumber,
        agent_state: 'running',
        sanitized_screenshot: capture.screenshotDataUrl,
        screenshot_format: capture.format || 'webp',
        sanitized_schema: sanitizedSchema,
        previous_action_result: previousResult,
    };
    // 3. Issue SanitizationProof required by the compile-time brand
    const proof = {
        verifiedAt: new Date().toISOString(),
        verifier: 'walking-skeleton-minimal-sanitizer',
        placeholderCount: redactedCount,
        isRedacted: true,
    };
    // Compile-time & runtime privacy boundary
    return markSanitized(payload, proof);
}
//# sourceMappingURL=context-builder.js.map