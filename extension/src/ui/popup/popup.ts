import { slog } from '@aegis/shared';
import type {
  BusMessage,
  SessionStateUpdateMessage,
  StartSessionMessage,
  CancelSessionMessage,
} from '../../background/bus';

// ── DOM refs ──────────────────────────────────────────────
const startBtn     = document.getElementById('start-btn')     as HTMLButtonElement;
const cancelBtn    = document.getElementById('cancel-btn')    as HTMLButtonElement;
const goalInput    = document.getElementById('goal-input')    as HTMLTextAreaElement;
const statusLabel  = document.getElementById('agent-status')  as HTMLElement;
const stepCounter  = document.getElementById('step-counter')  as HTMLElement;
const progressBar  = document.getElementById('progress-track') as HTMLElement;
const connDot      = document.getElementById('conn-dot')      as HTMLElement;
const connLabel    = document.getElementById('conn-label')    as HTMLElement;
const logBox       = document.getElementById('log-box')       as HTMLElement;
const logEmpty     = document.getElementById('log-empty')     as HTMLElement;

let maxStepsGlobal = 30;

// ── Logging helper ────────────────────────────────────────
function addLog(text: string, type: 'action' | 'success' | 'error' | 'info' = 'info'): void {
  if (logEmpty) logEmpty.remove();

  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const row = document.createElement('div');
  row.className = 'log-entry';
  row.innerHTML = `
    <span class="log-time">${ts}</span>
    <span class="log-text ${type}">${text}</span>
  `;

  logBox.appendChild(row);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── Connection status ─────────────────────────────────────
function setConnected(online: boolean): void {
  connDot.className  = 'dot' + (online ? ' online' : '');
  connLabel.textContent = online ? 'Connected' : 'Offline';
}

// ── Progress bar ──────────────────────────────────────────
function setProgress(step: number, max: number): void {
  const pct = max > 0 ? Math.min(100, (step / max) * 100) : 0;
  progressBar.style.width = `${pct}%`;
}

// ── Status colours ────────────────────────────────────────
const STATE_CLASS: Record<string, string> = {
  running:   'running',
  completed: 'completed',
  failed:    'failed',
  cancelled: 'failed',
  idle:      '',
};

// ── Update all UI from a session state message ─────────────
function updateUI(update: SessionStateUpdateMessage): void {
  const state = update.state;
  maxStepsGlobal = update.maxSteps || 30;

  // Status label
  statusLabel.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  statusLabel.className = '';
  if (STATE_CLASS[state]) statusLabel.classList.add(STATE_CLASS[state]);

  // Step counter
  const currentStep = update.step ?? 0;
  stepCounter.textContent = `${currentStep} / ${maxStepsGlobal}`;

  // Progress bar
  setProgress(currentStep, maxStepsGlobal);

  // Button state
  const running = state === 'running';
  startBtn.disabled    = running;
  cancelBtn.disabled   = !running;
  goalInput.disabled   = running;

  // Connection dot
  setConnected(state !== 'idle' && state !== 'failed');

  // Log entry for action changes
  if (update.lastAction) {
    addLog(`Action: ${update.lastAction}${update.reasoning ? ` — ${update.reasoning.slice(0, 60)}` : ''}`, 'action');
  }

  if (state === 'completed') {
    addLog('Goal achieved ✓', 'success');
    setConnected(false);
  } else if (state === 'failed') {
    addLog(update.error ? `Failed: ${update.error}` : 'Session failed', 'error');
    setConnected(false);
  } else if (state === 'cancelled') {
    addLog('Session cancelled', 'info');
    setConnected(false);
  }
}

// ── Init ──────────────────────────────────────────────────
slog.info({ module: 'POPUP_UI', event: 'POPUP_OPENED', status: 'IDLE' });

if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
  // Fetch initial state
  chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' }, (response: SessionStateUpdateMessage) => {
    if (response) updateUI(response);
  });

  // Live state updates from service worker
  chrome.runtime.onMessage.addListener((message: BusMessage) => {
    if (message.type === 'SESSION_STATE_UPDATE') {
      updateUI(message);
    }
  });
}

// ── Start button ──────────────────────────────────────────
startBtn?.addEventListener('click', () => {
  const goal = goalInput.value.trim();
  if (!goal) {
    goalInput.style.borderColor = 'var(--red)';
    goalInput.focus();
    setTimeout(() => { goalInput.style.borderColor = ''; }, 1500);
    return;
  }

  slog.info({ module: 'POPUP_UI', event: 'SESSION_START_REQUESTED' });

  statusLabel.textContent = 'Starting…';
  statusLabel.className = 'running';
  stepCounter.textContent = `0 / ${maxStepsGlobal}`;
  progressBar.style.width = '0%';
  startBtn.disabled  = true;
  cancelBtn.disabled = false;
  goalInput.disabled = true;
  setConnected(true);
  addLog(`Starting: "${goal.slice(0, 50)}${goal.length > 50 ? '…' : ''}"`, 'info');

  const msg: StartSessionMessage = { type: 'START_SESSION', goal };
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(msg);
  }
});

// ── Cancel button ─────────────────────────────────────────
cancelBtn?.addEventListener('click', () => {
  slog.info({ module: 'POPUP_UI', event: 'SESSION_CANCEL_REQUESTED' });

  statusLabel.textContent = 'Cancelling…';
  cancelBtn.disabled = true;
  addLog('Cancellation requested…', 'info');

  const msg: CancelSessionMessage = { type: 'CANCEL_SESSION' };
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(msg);
  }
});
