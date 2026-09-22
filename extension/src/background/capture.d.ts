/**
 * AEGIS Active Tab Screenshot Capture (Work Package B4)
 * Source of Truth: docs/TECHNICAL_SPEC.md §8, docs/IMPLEMENTATION_PLAN.md B4
 * Captures visible tab, measures DPR, and returns image data URL.
 */
export declare const MINIMAL_WEBP_BASE64 = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=";
export interface CaptureResult {
    screenshotDataUrl: string;
    format: 'webp' | 'jpeg';
    dpr: number;
    width: number;
    height: number;
}
export declare function captureActiveTab(tabId?: number): Promise<CaptureResult>;
//# sourceMappingURL=capture.d.ts.map