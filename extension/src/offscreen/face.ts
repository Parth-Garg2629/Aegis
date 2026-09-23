import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { slog } from '@aegis/shared';
import type { FaceSignal } from '@aegis/core';
import { FACE_DETECTION_DISCARD_THRESHOLD } from '@aegis/core';

export interface FaceDetectorAssetPaths {
  wasmBasePath: string;
  modelAssetPath: string;
}

export class AegisFaceDetector {
  private detector: FaceDetector | null = null;
  private available = false;

  isAvailable(): boolean {
    return this.available;
  }

  async load(paths: FaceDetectorAssetPaths): Promise<boolean> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(paths.wasmBasePath);
      this.detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: paths.modelAssetPath,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: FACE_DETECTION_DISCARD_THRESHOLD,
      });
      this.available = true;
      slog.info({ module: 'FACE_DETECTOR', event: 'FACE_DETECTOR_READY' });
      return true;
    } catch (err) {
      this.available = false;
      this.detector = null;
      slog.warn({
        module: 'FACE_DETECTOR',
        event: 'FACE_DETECTOR_LOAD_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  detect(image: ImageBitmap): FaceSignal[] {
    if (!this.available || !this.detector) return [];

    try {
      const result = this.detector.detect(image);
      const signals: FaceSignal[] = [];
      for (const d of result.detections) {
        if (!d.boundingBox) continue;
        signals.push({
          boundingBox: {
            x: d.boundingBox.originX / image.width,
            y: d.boundingBox.originY / image.height,
            w: d.boundingBox.width / image.width,
            h: d.boundingBox.height / image.height,
          },
          confidence: d.categories[0]?.score ?? 0,
        });
      }
      return signals;
    } catch (err) {
      slog.warn({
        module: 'FACE_DETECTOR',
        event: 'FACE_DETECTION_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async unload(): Promise<void> {
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
    this.available = false;
  }
}
