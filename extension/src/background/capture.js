import { slog } from '@aegis/shared';
export const MINIMAL_WEBP_BASE64 = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=';
export async function captureActiveTab(tabId, sessionId, stepNumber) {
    const startedAt = performance.now();
    const correlation = sessionId && stepNumber !== undefined ? `${sessionId}:${stepNumber}` : undefined;
    slog.info({ module: 'SCREENSHOT_CAPTURE', event: 'CAPTURE_START', session_id: sessionId, step_number: stepNumber, correlation_id: correlation, status: 'started' });
    try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.captureVisibleTab) {
            const currentTab = tabId
                ? await chrome.tabs.get(tabId)
                : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
            if (!currentTab || !currentTab.id) {
                throw new Error('No active tab available to capture');
            }
            const dataUrl = await chrome.tabs.captureVisibleTab(currentTab.windowId, {
                format: 'png',
            });
            if (!dataUrl) {
                throw new Error('E-CAPTURE-EMPTY');
            }
            const result = {
                screenshotDataUrl: dataUrl,
                format: 'webp',
                dpr: 1.0,
                width: currentTab.width || 1280,
                height: currentTab.height || 800,
            };
            slog.info({ module: 'SCREENSHOT_CAPTURE', event: 'CAPTURE_END', session_id: sessionId, step_number: stepNumber, correlation_id: correlation, duration_ms: Math.round(performance.now() - startedAt), screenshot_width: result.width, screenshot_height: result.height, dpr: result.dpr, status: 'success', success: true });
            return result;
        }
    }
    catch (err) {
        slog.warn({
            module: 'SCREENSHOT_CAPTURE',
            event: 'CAPTURE_ERROR',
            session_id: sessionId,
            step_number: stepNumber,
            correlation_id: correlation,
            duration_ms: Math.round(performance.now() - startedAt),
            error_code: 'CAPTURE_FAILED',
            status: 'error',
            success: false,
        });
    }
    slog.error({ module: 'SCREENSHOT_CAPTURE', event: 'CAPTURE_END', session_id: sessionId, step_number: stepNumber, correlation_id: correlation, duration_ms: Math.round(performance.now() - startedAt), error_code: 'CAPTURE_UNAVAILABLE', status: 'error', success: false });
    throw new Error('E-CAPTURE-UNAVAILABLE');
}
//# sourceMappingURL=capture.js.map
