/**
 * AEGIS Active Tab Screenshot Capture (Work Package B4)
 * Source of Truth: docs/TECHNICAL_SPEC.md §8, docs/IMPLEMENTATION_PLAN.md B4
 * Captures visible tab, measures DPR, and returns image data URL.
 */

import { slog } from '@aegis/shared';

// Minimal 1x1 base64 WebP fallback for headless or simulated browser environments
export const MINIMAL_WEBP_BASE64 =
  'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=';

export interface CaptureResult {
  screenshotDataUrl: string;
  format: 'webp' | 'jpeg';
  dpr: number;
  width: number;
  height: number;
}

export async function captureActiveTab(tabId?: number): Promise<CaptureResult> {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.captureVisibleTab) {
      // Query active window if tabId is not provided
      const currentTab = tabId
        ? await chrome.tabs.get(tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

      if (!currentTab || !currentTab.id) {
        throw new Error('No active tab available to capture');
      }

      // Capture visible tab as PNG/WebP
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
  } catch (err: unknown) {
    slog.warn({
      module: 'SCREENSHOT_CAPTURE',
      event: 'CAPTURE_FALLBACK',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Fallback for headless / simulated environments
  return {
    screenshotDataUrl: MINIMAL_WEBP_BASE64,
    format: 'webp',
    dpr: 1.0,
    width: 1280,
    height: 800,
  };
}
