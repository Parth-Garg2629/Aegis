/**
 * AEGIS Popup Controller
 */

import { slog } from '@aegis/shared';

const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const goalInput = document.getElementById('goal-input') as HTMLTextAreaElement;
const statusLabel = document.getElementById('agent-status') as HTMLElement;
const stepCounter = document.getElementById('step-counter') as HTMLElement;

slog.info({
  module: 'POPUP_UI',
  event: 'POPUP_OPENED',
  status: 'IDLE',
});

startBtn?.addEventListener('click', () => {
  const goal = goalInput.value.trim();
  if (!goal) return;

  slog.info({
    module: 'POPUP_UI',
    event: 'SESSION_START_REQUESTED',
  });

  statusLabel.textContent = 'Starting...';
  if (stepCounter) stepCounter.textContent = 'Step 1 / 30';
  startBtn.disabled = true;
  cancelBtn.disabled = false;
});

cancelBtn?.addEventListener('click', () => {
  slog.info({
    module: 'POPUP_UI',
    event: 'SESSION_CANCEL_REQUESTED',
  });

  statusLabel.textContent = 'Cancelled';
  if (stepCounter) stepCounter.textContent = 'Step 0 / 30';
  startBtn.disabled = false;
  cancelBtn.disabled = true;
});
