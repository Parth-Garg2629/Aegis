import type { SensitivityMap, Rect } from '@aegis/core';
import { slog } from '@aegis/shared';

export interface SanitizedScreenshotResult {
  dataUrl: string;
  redactedRegions: number;
  failedRegions: number;
}

// Convert data URL to ImageBitmap
async function createImageBitmapFromUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}

export async function sanitizeScreenshot(
  dataUrl: string,
  sensitivityMap: SensitivityMap,
  dpr: number
): Promise<SanitizedScreenshotResult> {
  let redactedRegions = 0;
  let failedRegions = 0;

  try {
    const img = await createImageBitmapFromUrl(dataUrl);
    
    // Create OffscreenCanvas matching original image size (full resolution)
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    
    if (!ctx) {
      throw new Error('Failed to get 2d context from OffscreenCanvas');
    }

    // Draw original image
    ctx.drawImage(img, 0, 0);

    // Apply redactions
    for (const region of sensitivityMap.regions) {
      try {
        const x = region.boundingBox.x * dpr;
        const y = region.boundingBox.y * dpr;
        const w = region.boundingBox.w * dpr;
        const h = region.boundingBox.h * dpr;

        if (region.sanitizationAction === 'BLUR_VISUAL') {
          // Pixelate + blur effect for faces
          // Basic pixelation: shrink and draw back scaled up
          const padding = 5 * dpr;
          const px = Math.max(0, x - padding);
          const py = Math.max(0, y - padding);
          const pw = Math.min(canvas.width - px, w + padding * 2);
          const ph = Math.min(canvas.height - py, h + padding * 2);
          
          if (pw > 0 && ph > 0) {
              const blockSize = Math.max(10, Math.floor(pw / 10)); // Block size proportional to face box
              const tempCanvas = new OffscreenCanvas(Math.max(1, Math.floor(pw / blockSize)), Math.max(1, Math.floor(ph / blockSize)));
              const tempCtx = tempCanvas.getContext('2d')!;
              tempCtx.drawImage(canvas, px, py, pw, ph, 0, 0, tempCanvas.width, tempCanvas.height);
              
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, px, py, pw, ph);
              ctx.imageSmoothingEnabled = true;
              
              // Apply simple blur over pixelated area
              ctx.filter = `blur(${5 * dpr}px)`;
              ctx.drawImage(canvas, px, py, pw, ph, px, py, pw, ph);
              ctx.filter = 'none';
          }
        } else {
          // BLUR_AND_REPLACE or MASK_VISUAL (Solid fill + label)
          ctx.fillStyle = '#000000'; // Black fill
          ctx.fillRect(x, y, w, h);
          
          ctx.fillStyle = '#FFFFFF'; // White text
          const fontSize = Math.max(12, Math.floor(12 * dpr));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'center';
          ctx.fillText(`[${region.category}]`, x + w / 2, y + h / 2, w - 4);
        }

        redactedRegions++;
      } catch (err) {
        failedRegions++;
        slog.warn({
          module: 'SCREENSHOT_SANITIZER',
          event: 'REGION_REDACTION_FAILED',
          error_code: 'E-SAN-01',
          reason: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // Downscale if necessary (e.g. to 1280x720 max bounds if needed, but per spec: downscale to 1280x720)
    // Actually spec says "downscale to 1280x720 (or actual viewport if smaller)".
    const MAX_W = 1280;
    const MAX_H = 720;
    let finalCanvas = canvas;
    
    if (canvas.width > MAX_W || canvas.height > MAX_H) {
       const scale = Math.min(MAX_W / canvas.width, MAX_H / canvas.height);
       const targetW = Math.floor(canvas.width * scale);
       const targetH = Math.floor(canvas.height * scale);
       
       finalCanvas = new OffscreenCanvas(targetW, targetH);
       const fCtx = finalCanvas.getContext('2d')!;
       fCtx.drawImage(canvas, 0, 0, targetW, targetH);
    }

    // Convert to webp
    // Note: convertToBlob is async
    const blob = await finalCanvas.convertToBlob({ type: 'image/webp', quality: 0.75 });
    
    // Read blob as data URL
    const reader = new FileReader();
    const sanitizedDataUrl = await new Promise<string>((resolve, reject) => {
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    return {
      dataUrl: sanitizedDataUrl,
      redactedRegions,
      failedRegions
    };
  } catch (err) {
    // Fail closed!
    throw new Error(`Sanitization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function applyFaceUnavailableFallback(canvas: OffscreenCanvas, regions: Rect[], dpr: number): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  
  let appliedCount = 0;
  for (const region of regions) {
    const x = region.x * dpr;
    const y = region.y * dpr;
    const w = region.w * dpr;
    const h = region.h * dpr;
    
    // Blur image regions >= 64x64
    if (w >= 64 * dpr && h >= 64 * dpr) {
      try {
        const blockSize = Math.max(10, Math.floor(w / 10));
        const tempCanvas = new OffscreenCanvas(Math.max(1, Math.floor(w / blockSize)), Math.max(1, Math.floor(h / blockSize)));
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.drawImage(canvas, x, y, w, h, 0, 0, tempCanvas.width, tempCanvas.height);
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
        
        ctx.filter = `blur(${5 * dpr}px)`;
        ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
        ctx.filter = 'none';
        appliedCount++;
      } catch (e) {
        // Ignore individual region failure
      }
    }
  }
  
  slog.info({
    module: 'SCREENSHOT_SANITIZER',
    event: 'FACE_UNAVAILABLE_FALLBACK_APPLIED',
    sanitized_count: appliedCount
  });
}
