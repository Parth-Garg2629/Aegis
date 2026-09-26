import { slog } from '@aegis/shared';
import type {
  BusMessage,
  ConfirmActionMessage,
  DenyActionMessage,
  SessionStateUpdateMessage,
  StartSessionMessage,
  CancelSessionMessage,
  DetailedState,
} from '../../background/bus';

// ── DOM refs ──────────────────────────────────────────────
const startBtn       = document.getElementById('start-btn')       as HTMLButtonElement;
const cancelBtn      = document.getElementById('cancel-btn')      as HTMLButtonElement;
const goalInput      = document.getElementById('goal-input')      as HTMLTextAreaElement;
const statusLabel    = document.getElementById('agent-status')    as HTMLElement;
const stepCounter    = document.getElementById('step-counter')    as HTMLElement;
const progressBar    = document.getElementById('progress-track')  as HTMLElement;
const progressWrap   = document.getElementById('progress-wrap')   as HTMLElement;
const connDot        = document.getElementById('conn-dot')        as HTMLElement;
const connLabel      = document.getElementById('conn-label')      as HTMLElement;
const logBox         = document.getElementById('log-box')         as HTMLElement;
const logEmpty       = document.getElementById('log-empty')       as HTMLElement;
const confirmPanel   = document.getElementById('confirm-panel')   as HTMLElement;
const confirmActionType = document.getElementById('confirm-action-type') as HTMLElement;
const confirmRiskCat = document.getElementById('confirm-risk-cat') as HTMLElement;
const confirmRiskReason = document.getElementById('confirm-risk-reason') as HTMLElement;
const confirmReasoningWrap = document.getElementById('confirm-reasoning-wrap') as HTMLElement;
const confirmReasoning = document.getElementById('confirm-reasoning') as HTMLElement;
const approveBtn     = document.getElementById('approve-btn')     as HTMLButtonElement;
const denyBtn        = document.getElementById('deny-btn')        as HTMLButtonElement;
const providerBar    = document.getElementById('provider-bar')    as HTMLElement;
const providerName   = document.getElementById('provider-name')   as HTMLElement;
const mockBadge      = document.getElementById('mock-badge')      as HTMLElement;

let maxStepsGlobal = 30;
let lastDetailedState: DetailedState = 'idle';

// ── Logging helper ────────────────────────────────────────
function addLog(text: string, type: 'action' | 'success' | 'error' | 'warning' | 'info' = 'info'): void {
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
function setConnection(status: 'online' | 'offline' | 'warning', label: string): void {
  connDot.className = 'dot';
  if (status === 'online') connDot.classList.add('online');
  if (status === 'warning') connDot.classList.add('warning');
  connLabel.textContent = label;
}

// ── Progress bar ──────────────────────────────────────────
function setProgress(step: number, max: number): void {
  const pct = max > 0 ? Math.min(100, (step / max) * 100) : 0;
  progressBar.style.width = `${pct}%`;
}

// ── Detailed state labels ─────────────────────────────────
const DETAILED_STATE_LABELS: Record<DetailedState, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  starting: 'Starting Session…',
  capturing: 'Capturing Page…',
  analyzing: 'Analyzing…',
  sanitizing: 'Sanitizing Data…',
  awaiting_action: 'Waiting for AI…',
  awaiting_confirmation: '⚠ Confirmation Required',
  executing: 'Executing Action…',
  completed: 'Completed ✓',
  failed: 'Failed',
  cancelled: 'Cancelled',
  reconnecting: 'Reconnecting…',
  blocked: 'Blocked',
};

const DETAILED_STATE_CLASS: Record<string, string> = {
  idle: '',
  connecting: 'running',
  starting: 'running',
  capturing: 'running',
  analyzing: 'running',
  sanitizing: 'running',
  awaiting_action: 'running',
  awaiting_confirmation: 'confirming',
  executing: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  reconnecting: 'running',
  blocked: 'failed',
};

// ── Confirmation Panel ────────────────────────────────────
function showConfirmation(update: SessionStateUpdateMessage): void {
  const pc = update.pendingConfirmation;
  if (!pc) return;

  confirmActionType.textContent = pc.actionType;
  confirmRiskCat.textContent = pc.riskCategory;
  confirmRiskReason.textContent = pc.riskReason;

  if (pc.reasoning) {
    confirmReasoningWrap.style.display = 'block';
    confirmReasoning.textContent = pc.reasoning.slice(0, 120);
  } else {
    confirmReasoningWrap.style.display = 'none';
  }

  confirmPanel.classList.add('visible');
  approveBtn.disabled = false;
  denyBtn.disabled = false;
}

function hideConfirmation(): void {
  confirmPanel.classList.remove('visible');
  approveBtn.disabled = true;
  denyBtn.disabled = true;
}

// ── Provider info ─────────────────────────────────────────
function updateProviderInfo(update: SessionStateUpdateMessage): void {
  const pi = update.providerInfo;
  if (pi && pi.providerName) {
    providerBar.style.display = 'flex';
    providerName.textContent = pi.modelName ? `${pi.providerName} / ${pi.modelName}` : pi.providerName;
    mockBadge.style.display = 'inline-block';
    if (pi.isMock) {
      mockBadge.textContent = 'MOCK';
      mockBadge.className = 'mock-badge mock';
    } else if (pi.providerName.toLowerCase() === 'ollama') {
      mockBadge.textContent = 'LOCAL';
      mockBadge.className = 'mock-badge real-local';
    } else {
      mockBadge.textContent = 'REAL';
      mockBadge.className = 'mock-badge real';
    }
  }
}

// ── Update all UI from a session state message ─────────────
function updateUI(update: SessionStateUpdateMessage): void {
  const detailedState = update.detailedState || update.state;
  maxStepsGlobal = update.maxSteps || 30;

  // Avoid duplicate log entries for same state
  const stateChanged = detailedState !== lastDetailedState;
  lastDetailedState = detailedState as DetailedState;

  // Status label
  const label = DETAILED_STATE_LABELS[detailedState as DetailedState] || detailedState;
  statusLabel.textContent = label;
  statusLabel.className = '';
  const cssClass = DETAILED_STATE_CLASS[detailedState] || '';
  if (cssClass) statusLabel.classList.add(cssClass);

  // Step counter
  const currentStep = update.step ?? 0;
  stepCounter.textContent = `${currentStep} / ${maxStepsGlobal}`;

  // Progress bar
  setProgress(currentStep, maxStepsGlobal);

  // Scanning animation
  const isActive = !['idle', 'completed', 'failed', 'cancelled', 'blocked', 'awaiting_confirmation'].includes(detailedState);
  if (isActive) {
    progressWrap.classList.add('scanning');
  } else {
    progressWrap.classList.remove('scanning');
  }

  // Button state
  const isRunning = !['idle', 'completed', 'failed', 'cancelled'].includes(detailedState);
  startBtn.disabled = isRunning;
  cancelBtn.disabled = !isRunning;
  goalInput.disabled = isRunning;

  // Connection dot
  if (detailedState === 'idle' || detailedState === 'completed' || detailedState === 'failed' || detailedState === 'cancelled') {
    setConnection('offline', 'Offline');
  } else if (detailedState === 'reconnecting') {
    setConnection('warning', 'Reconnecting…');
  } else if (detailedState === 'awaiting_confirmation') {
    setConnection('warning', 'Awaiting');
  } else {
    setConnection('online', 'Connected');
  }

  // Confirmation panel
  if (detailedState === 'awaiting_confirmation' && update.pendingConfirmation) {
    showConfirmation(update);
  } else {
    hideConfirmation();
  }

  // Provider info
  updateProviderInfo(update);

  // Log entries for state changes
  if (stateChanged) {
    if (update.lastAction) {
      addLog(`Action: ${update.lastAction}${update.reasoning ? ` — ${update.reasoning.slice(0, 60)}` : ''}`, 'action');
    }

    if (detailedState === 'awaiting_confirmation') {
      addLog(`⚠ High-risk action requires approval: ${update.pendingConfirmation?.actionType || 'unknown'}`, 'warning');
    }

    if (detailedState === 'completed') {
      addLog('Goal achieved ✓', 'success');
    } else if (detailedState === 'failed') {
      addLog(update.error ? `Failed: ${update.error}` : 'Session failed', 'error');
    } else if (detailedState === 'cancelled') {
      addLog('Session cancelled', 'info');
    } else if (detailedState === 'blocked') {
      addLog(`Action blocked: ${update.error || 'Risk engine blocked this action'}`, 'error');
    }
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
  setConnection('online', 'Connecting');
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

// ── Approve button ────────────────────────────────────────
approveBtn?.addEventListener('click', () => {
  slog.info({ module: 'POPUP_UI', event: 'ACTION_APPROVED' });
  approveBtn.disabled = true;
  denyBtn.disabled = true;
  addLog('Action approved by user ✓', 'success');

  const msg: ConfirmActionMessage = { type: 'CONFIRM_ACTION' };
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(msg);
  }
});

// ── Deny button ───────────────────────────────────────────
denyBtn?.addEventListener('click', () => {
  slog.info({ module: 'POPUP_UI', event: 'ACTION_DENIED' });
  approveBtn.disabled = true;
  denyBtn.disabled = true;
  addLog('Action denied by user ✗', 'error');

  const msg: DenyActionMessage = { type: 'DENY_ACTION' };
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(msg);
  }
});
