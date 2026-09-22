/**
 * AEGIS Offscreen Document Entrypoint (ADR-02)
 * Hosts ML models (ONNX Runtime Web, MediaPipe Face Detector) and canvas sanitization.
 */
import { slog } from '@aegis/shared';
slog.info({
    module: 'OFFSCREEN_RUNTIME',
    event: 'OFFSCREEN_INITIALIZED',
    status: 'READY',
});
//# sourceMappingURL=runtime.js.map