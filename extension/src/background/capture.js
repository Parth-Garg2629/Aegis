import { slog } from '@aegis/shared';
export const MINIMAL_WEBP_BASE64 = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=';
export async function captureActiveTab(tabId) {
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
            return {
                screenshotDataUrl: dataUrl || MINIMAL_WEBP_BASE64,
                format: 'webp',
                dpr: 1.0,
                width: currentTab.width || 1280,
                height: currentTab.height || 800,
            };
        }
    }
    catch (err) {
        slog.warn({
            module: 'SCREENSHOT_CAPTURE',
            event: 'CAPTURE_FALLBACK',
            message: err instanceof Error ? err.message : String(err),
        });
    }
    return {
        screenshotDataUrl: MINIMAL_WEBP_BASE64,
        format: 'webp',
        dpr: 1.0,
        width: 1280,
        height: 800,
    };
}
//# sourceMappingURL=capture.js.map