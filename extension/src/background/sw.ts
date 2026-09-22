/**
 * AEGIS Background Service Worker Entrypoint (ADR-02)
 * Orchestrates Loop Controller, Screenshot Capture, and WebSocket client.
 */

import { slog } from '@aegis/shared';

slog.info({
  module: 'SERVICE_WORKER',
  event: 'SW_INITIALIZED',
  status: 'READY',
});

chrome.runtime.onInstalled.addListener(() => {
  slog.info({
    module: 'SERVICE_WORKER',
    event: 'EXTENSION_INSTALLED',
  });
});
