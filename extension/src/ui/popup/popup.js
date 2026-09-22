/**
 * AEGIS Popup Controller (Work Package B7 / Integration)
 * Coordinates UI inputs and displays live agent loop state from Service Worker.
 */
import { slog } from '@aegis/shared';
const startBtn = document.getElementById('start-btn');
const cancelBtn = document.getElementById('cancel-btn');
const goalInput = document.getElementById('goal-input');
const statusLabel = document.getElementById('agent-status');
const stepCounter = document.getElementById('step-counter');
slog.info({
    module: 'POPUP_UI',
    event: 'POPUP_OPENED',
    status: 'IDLE',
});
function updateUI(update) {
    if (statusLabel) {
        statusLabel.textContent = update.state.charAt(0).toUpperCase() + update.state.slice(1);
    }
    if (stepCounter) {
        stepCounter.textContent = `Step ${update.step} / ${update.maxSteps}`;
    }
    if (update.state === 'running') {
        startBtn.disabled = true;
        cancelBtn.disabled = false;
        goalInput.disabled = true;
    }
    else if (update.state === 'completed' || update.state === 'failed' || update.state === 'cancelled') {
        startBtn.disabled = false;
        cancelBtn.disabled = true;
        goalInput.disabled = false;
    }
    else {
        startBtn.disabled = false;
        cancelBtn.disabled = true;
        goalInput.disabled = false;
    }
}
// Fetch current session state on open
if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' }, (response) => {
        if (response) {
            updateUI(response);
        }
    });
    // Listen for real-time broadcasts from Service Worker
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'SESSION_STATE_UPDATE') {
            updateUI(message);
        }
    });
}
startBtn?.addEventListener('click', () => {
    const goal = goalInput.value.trim();
    if (!goal)
        return;
    slog.info({
        module: 'POPUP_UI',
        event: 'SESSION_START_REQUESTED',
        goal,
    });
    if (statusLabel)
        statusLabel.textContent = 'Starting...';
    if (stepCounter)
        stepCounter.textContent = 'Step 1 / 30';
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    goalInput.disabled = true;
    const msg = {
        type: 'START_SESSION',
        goal,
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg);
    }
});
cancelBtn?.addEventListener('click', () => {
    slog.info({
        module: 'POPUP_UI',
        event: 'SESSION_CANCEL_REQUESTED',
    });
    if (statusLabel)
        statusLabel.textContent = 'Cancelled';
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    goalInput.disabled = false;
    const msg = {
        type: 'CANCEL_SESSION',
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg);
    }
});
//# sourceMappingURL=popup.js.map