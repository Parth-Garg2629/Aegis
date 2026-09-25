import { slog } from '@aegis/shared';

let creatingPromise: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    return;
  }

  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
      return;
    }
  } catch {
    // continue to createDocument
  }

  if (creatingPromise) {
    return creatingPromise;
  }

  creatingPromise = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS', 'DOM_PARSER'] as any,
        justification: 'On-device perception and screenshot sanitization',
      });
      slog.info({
        module: 'OFFSCREEN_MANAGER',
        event: 'OFFSCREEN_DOCUMENT_CREATED',
      });
    } catch (err: any) {
      if (!err?.message?.includes('Only a single offscreen document may be created')) {
        slog.warn({
          module: 'OFFSCREEN_MANAGER',
          event: 'OFFSCREEN_CREATE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      creatingPromise = null;
    }
  })();

  return creatingPromise;
}
