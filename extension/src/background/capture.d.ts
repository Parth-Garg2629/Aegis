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