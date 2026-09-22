/**
 * AEGIS Background Service Worker Entrypoint (ADR-02)
 * Orchestrates Loop Controller, Screenshot Capture, and WebSocket client.
 */

import { slog } from '@aegis/shared';
import { LoopController } from './loop-controller';
import type { BusMessage, SessionStateUpdateMessage } from './bus';

let loopController: LoopController | null = null;
let lastKnownState: SessionStateUpdateMessage = {
  type: 'SESSION_STATE_UPDATE',
  state: 'idle',
  step: 0,
  maxSteps: 30,
};

function getOrCreateLoopController(): LoopController {
  if (!loopController) {
    loopController = new LoopController({
      onStateChange: (update) => {
        lastKnownState = update;
        // Broadcast state update to extension pages (Popup, etc.)
        chrome.runtime.sendMessage(update).catch(() => {
          // No listener open; safe to ignore
        });
      },
    });
  }
  return loopController;
}

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

chrome.runtime.onMessage.addListener((message: BusMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_SESSION': {
      const controller = getOrCreateLoopController();
      controller
        .start(message.goal)
        .catch((err) => {
          slog.error({
            module: 'SERVICE_WORKER',
            event: 'SESSION_START_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
        });
      sendResponse({ success: true });
      break;
    }

    case 'CANCEL_SESSION': {
      if (loopController) {
        loopController.cancel();
      }
      sendResponse({ success: true });
      break;
    }

    case 'GET_SESSION_STATE': {
      sendResponse(lastKnownState);
      break;
    }

    default:
      break;
  }
  return false;
});
