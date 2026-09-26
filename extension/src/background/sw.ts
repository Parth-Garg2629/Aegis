import { slog } from '@aegis/shared';
import { LoopController } from './loop-controller';
import { ensureOffscreenDocument } from './offscreen-manager';
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
        chrome.runtime.sendMessage(update).catch(() => {
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
  ensureOffscreenDocument().catch(() => {});
});

chrome.runtime.onMessage.addListener((message: BusMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_SESSION': {
      ensureOffscreenDocument().catch(() => {});
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

    case 'CONFIRM_ACTION': {
      // Route user approve/deny decision back to the paused loop controller
      if (loopController) {
        loopController.handleConfirmation(message.approved);
      }
      sendResponse({ success: true });
      break;
    }

    default:
      break;
  }
  return false;
});
