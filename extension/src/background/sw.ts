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

const SESSION_STATE_KEY = 'aegis_last_session_state';

function stateForStorage(update: SessionStateUpdateMessage): SessionStateUpdateMessage {
  // The popup needs only status metadata. Never persist goal text, model
  // reasoning, values, page data, or screenshots.
  return {
    type: 'SESSION_STATE_UPDATE',
    state: update.state,
    step: update.step,
    maxSteps: update.maxSteps,
    lastAction: update.lastAction,
    error: update.error,
    confirmMeta: update.confirmMeta,
  };
}

async function restoreLastKnownState(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(SESSION_STATE_KEY);
    const candidate = stored[SESSION_STATE_KEY] as SessionStateUpdateMessage | undefined;
    if (!candidate || candidate.type !== 'SESSION_STATE_UPDATE') return;

    // A restarted MV3 worker has no live controller or socket to resume. Do
    // not display an orphaned running state as though work were continuing.
    if (candidate.state === 'running' || candidate.state === 'confirming' || candidate.state === 'paused') {
      lastKnownState = {
        ...stateForStorage(candidate),
        state: 'failed',
        error: 'The extension service worker restarted during the session',
      };
      await chrome.storage.session.set({ [SESSION_STATE_KEY]: lastKnownState });
      return;
    }
    lastKnownState = stateForStorage(candidate);
  } catch {
    slog.warn({ module: 'SERVICE_WORKER', event: 'SESSION_STATE_RESTORE_FAILED', status: 'error' });
  }
}

const restoredState = restoreLastKnownState();

function getOrCreateLoopController(): LoopController {
  if (!loopController) {
    loopController = new LoopController({
      onStateChange: (update) => {
        lastKnownState = stateForStorage(update);
        void chrome.storage.session.set({ [SESSION_STATE_KEY]: lastKnownState });
        chrome.runtime.sendMessage(update).catch(() => {
        });
        if (update.state === 'completed' || update.state === 'failed' || update.state === 'cancelled') {
          loopController = null;
        }
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

// `chrome.storage.session` survives service-worker restarts within this browser
// session. This counter is diagnostic only; it does not restore loop behavior.
void chrome.storage.session.get('aegis_sw_start_count').then((stored) => {
  const startCount = Number(stored.aegis_sw_start_count || 0) + 1;
  return chrome.storage.session.set({ aegis_sw_start_count: startCount }).then(() => {
    slog.info({
      module: 'SERVICE_WORKER',
      event: startCount > 1 ? 'SERVICE_WORKER_RESTART' : 'SERVICE_WORKER_STARTUP',
      restart_count: startCount - 1,
      status: 'started',
    });
  });
}).catch(() => {
  slog.warn({ module: 'SERVICE_WORKER', event: 'START_COUNTER_UNAVAILABLE', status: 'unknown' });
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
      void restoredState.then(() => sendResponse(lastKnownState));
      return true;
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
