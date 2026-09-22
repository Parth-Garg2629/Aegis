/**
 * AEGIS Popup Controller
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
startBtn?.addEventListener('click', () => {
    const goal = goalInput.value.trim();
    if (!goal)
        return;
    slog.info({
        module: 'POPUP_UI',
        event: 'SESSION_START_REQUESTED',
    });
    statusLabel.textContent = 'Starting...';
    if (stepCounter)
        stepCounter.textContent = 'Step 1 / 30';
    startBtn.disabled = true;
    cancelBtn.disabled = false;
});
cancelBtn?.addEventListener('click', () => {
    slog.info({
        module: 'POPUP_UI',
        event: 'SESSION_CANCEL_REQUESTED',
    });
    statusLabel.textContent = 'Cancelled';
    if (stepCounter)
        stepCounter.textContent = 'Step 0 / 30';
    startBtn.disabled = false;
    cancelBtn.disabled = true;
});
//# sourceMappingURL=popup.js.map