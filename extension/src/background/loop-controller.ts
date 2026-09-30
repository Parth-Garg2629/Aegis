import type {
  ActionMessage,
  ActionObject,
  ActionResultPayload,
  ClientMetadata,
  PreviousActionResult,
  SanitizedSchema,
  SessionCreatedMessage,
  SessionEndPayload,
} from '@aegis/protocol';
import { DEFAULT_SERVER_ENDPOINT, slog } from '@aegis/shared';
import { captureActiveTab } from './capture';
import { ensureOffscreenDocument } from './offscreen-manager';
import { AegisWebSocketClient } from './ws-client';
import { scanGoal, validateAction, evaluateActionRisk } from '@aegis/core';
import type {
  ExecuteActionRequestMessage,
  ExecuteActionResponseMessage,
  ExtractDomRequestMessage,
  ExtractDomResponseMessage,
  SessionStateUpdateMessage,
} from './bus';

export type LoopState =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'sanitizing'
  | 'awaiting_action'
  | 'executing'
  | 'confirming'       // ← NEW: paused waiting for user approve/deny
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LoopControllerOptions {
  serverUrl?: string;
  maxSteps?: number;
  onStateChange?: (update: SessionStateUpdateMessage) => void;
}

// Metadata sent to popup during confirming state — privacy-safe only
export interface ConfirmationMeta {
  actionType: string;
  target: string | null;
  riskReason: string;
}

interface PendingSessionWait {
  resolve: (message: SessionCreatedMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingActionWait {
  sessionId: string | null;
  stepNumber: number;
  resolve: (action: ActionObject) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

async function sendMessageWithRetry<T = any>(message: any, maxRetries = 15, delayMs = 200): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime not available');
  }
  const nonce = Math.random().toString(36).slice(2);
  const taggedMessage = { ...message, _nonce: nonce };
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(taggedMessage);
      if (response !== undefined && response !== null && response._nonce === nonce) {
        return response;
      }
    } catch (err: any) {
      if (attempt === maxRetries - 1 || !err?.message?.includes('Receiving end does not exist')) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Message sending timed out without response');
}

export class LoopController {
  private state: LoopState = 'idle';
  private currentStep = 0;
  private maxSteps = 30;
  private goal = '';
  private activeTabId: number | null = null;
  private previousResult: PreviousActionResult | null = null;
  private wsClient: AegisWebSocketClient;
  private onStateChange?: (update: SessionStateUpdateMessage) => void;

  private pendingActionWait: PendingActionWait | null = null;
  private pendingSessionWait: PendingSessionWait | null = null;

  // Confirmation flow: resolve = user responded (true=approved, false=denied)
  private pendingConfirmResolver: ((approved: boolean) => void) | null = null;

  constructor(options: LoopControllerOptions = {}) {
    this.maxSteps = options.maxSteps || 30;
    this.onStateChange = options.onStateChange;
    this.wsClient = new AegisWebSocketClient(options.serverUrl || DEFAULT_SERVER_ENDPOINT);

    this.wsClient.setCallbacks({
      onSessionCreated: (msg) => {
        const wait = this.pendingSessionWait;
        if (!wait) return;
        this.pendingSessionWait = null;
        clearTimeout(wait.timeout);
        wait.resolve(msg);
      },
      onAction: (msg: ActionMessage) => {
        slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_RECEIVED', session_id: msg.session_id, step_number: msg.payload.step_number, action_type: msg.payload.action.action_type, correlation_id: `${msg.session_id}:${msg.payload.step_number}` });
        const wait = this.pendingActionWait;
        if (!wait) return;
        if (msg.session_id !== wait.sessionId || msg.payload.step_number !== wait.stepNumber) {
          slog.warn({
            module: 'LOOP_CONTROLLER',
            event: 'STALE_ACTION_IGNORED',
            session_id: msg.session_id,
            step_number: msg.payload.step_number,
            action_type: msg.payload.action.action_type,
            error_code: 'ACTION_CORRELATION_MISMATCH',
          });
          return;
        }
        this.pendingActionWait = null;
        clearTimeout(wait.timeout);
        wait.resolve(msg.payload.action);
      },
      onSessionError: (msg) => {
        slog.error({
          module: 'LOOP_CONTROLLER',
          event: 'SERVER_ERROR_RECEIVED',
          code: msg.payload.error_code,
          message: msg.payload.error_message,
        });
        this.rejectPendingAction(new Error(msg.payload.error_message));
      },
      onClose: () => {
        this.rejectPendingSession(new Error('WebSocket closed before session creation'));
        this.rejectPendingAction(new Error('WebSocket closed while waiting for an action'));
        if (this.pendingConfirmResolver) {
          const resolve = this.pendingConfirmResolver;
          this.pendingConfirmResolver = null;
          resolve(false);
        }
        if (this.state !== 'completed' && this.state !== 'failed' && this.state !== 'cancelled' && this.state !== 'idle') {
          this.transition('failed', { error: 'WebSocket disconnected unexpectedly' });
        }
      },
    });
  }

  public getState(): LoopState {
    return this.state;
  }

  public getCurrentStep(): number {
    return this.currentStep;
  }

  public getMaxSteps(): number {
    return this.maxSteps;
  }

  public getSessionId(): string | null {
    return this.wsClient.getSessionId();
  }

  /**
   * Called by sw.ts when the popup sends CONFIRM_ACTION (approved=true/false).
   * Safe to call in any state; only acts during 'confirming'.
   */
  public handleConfirmation(approved: boolean): void {
    slog.info({
      module: 'LOOP_CONTROLLER',
      event: 'CONFIRMATION_RECEIVED',
      approved,
      step: this.currentStep,
    });
    if (this.state !== 'confirming' || !this.pendingConfirmResolver) {
      slog.warn({
        module: 'LOOP_CONTROLLER',
        event: 'CONFIRMATION_IGNORED',
        reason: 'Not in confirming state or no resolver pending',
      });
      return;
    }
    const resolve = this.pendingConfirmResolver;
    this.pendingConfirmResolver = null;
    resolve(approved);
  }

  public async start(goal: string, targetTabId?: number): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'completed' && this.state !== 'failed' && this.state !== 'cancelled') {
      throw new Error(`Cannot start loop while in state "${this.state}"`);
    }

    const goalScan = scanGoal(goal);
    this.goal = goalScan.sanitizedGoal;
    if (goalScan.hasSensitiveContent) {
      slog.warn({
        module: 'LOOP_CONTROLLER',
        event: 'GOAL_CONTAINS_SENSITIVE_CONTENT',
        categories: goalScan.categories,
      });
    }
    this.currentStep = 0;
    this.previousResult = null;
    this.transition('starting');

    try {
      if (targetTabId !== undefined) {
        this.activeTabId = targetTabId;
      } else if (typeof chrome !== 'undefined' && chrome.tabs) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        this.activeTabId = tabs[0]?.id ?? null;
      }

      await this.wsClient.connect();

      const clientMeta: ClientMetadata = {
        extension_version: '1.0.0',
        browser: 'chrome',
        browser_version: '120.0',
        max_steps: this.maxSteps,
      };

      const sessionCreatedPromise = new Promise<SessionCreatedMessage>((resolve, reject) => {
        const wait: PendingSessionWait = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            if (this.pendingSessionWait !== wait) return;
            this.pendingSessionWait = null;
            reject(new Error('Timed out waiting for session_created'));
          }, 10000),
        };
        this.pendingSessionWait = wait;
      });

      this.wsClient.sendSessionInit(this.goal, clientMeta);
      const sessionCreated = await sessionCreatedPromise;
      if (sessionCreated.payload.server_max_steps) {
        this.maxSteps = sessionCreated.payload.server_max_steps;
      }

      this.currentStep = 1;
      await this.runLoop();
    } catch (err: unknown) {
      if (this.state === 'completed' || this.state === 'failed' || this.state === 'cancelled') return;
      const message = err instanceof Error ? err.message : String(err);
      slog.error({
        module: 'LOOP_CONTROLLER',
        event: 'LOOP_START_FAILED',
        error_code: message.startsWith('E-') ? message : 'LOOP_START_FAILED',
      });
      if (this.wsClient.getSessionId()) {
        this.finish('agent_failed', this.safeFailureCode(message));
      } else {
        this.wsClient.disconnect();
        this.transition('failed', { error: this.safeFailureCode(message) });
      }
    }
  }

  public cancel(): void {
    if (this.state === 'idle' || this.state === 'completed' || this.state === 'cancelled') return;

    slog.info({
      module: 'LOOP_CONTROLLER',
      event: 'SESSION_CANCELLED',
      step: this.currentStep,
    });

    // If paused in confirming, resolve as denied so the loop exits cleanly
    if (this.pendingConfirmResolver) {
      const resolve = this.pendingConfirmResolver;
      this.pendingConfirmResolver = null;
      resolve(false);
    }

    try {
      this.wsClient.sendSessionEnd('user_cancelled', this.currentStep);
    } catch {
      slog.warn({ module: 'LOOP_CONTROLLER', event: 'SESSION_END_SEND_FAILED', error_code: 'SESSION_END_SEND_FAILED' });
    }
    this.rejectPendingSession(new Error('Session cancelled'));
    this.rejectPendingAction(new Error('Session cancelled'));
    this.wsClient.disconnect();
    this.transition('cancelled');
  }

  private async runLoop(): Promise<void> {
    while (this.state !== 'completed' && this.state !== 'failed' && this.state !== 'cancelled') {
      if (this.currentStep > this.maxSteps) {
        slog.info({
          module: 'LOOP_CONTROLLER',
          event: 'MAX_STEPS_REACHED',
          step: this.currentStep,
        });
        this.finish('max_steps_reached');
        break;
      }

      slog.info({
        module: 'LOOP_CONTROLLER',
        event: 'NEXT_CYCLE_START',
        step_number: this.currentStep,
        session_id: this.wsClient.getSessionId() || undefined,
        correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`,
      });

      this.transition('capturing');
      const captureResult = await captureActiveTab(this.activeTabId || undefined, this.wsClient.getSessionId() || undefined, this.currentStep);

      const { schema: domSchema, domSignals, piiSignals } = await this.extractDomFromActiveTab();

      // D6 Goal Scanning
      const goalScan = scanGoal(this.goal);
      if (goalScan.hasSensitiveContent) {
          slog.warn({
              module: 'LOOP_CONTROLLER',
              event: 'GOAL_CONTAINS_PII',
              message: 'Goal text contained sensitive information which was scrubbed.'
          });
      }

      this.transition('sanitizing');
      
      let sanitizedPayload: any;
      
      try {
        // Run Perception Cycle (Offscreen)
        const perceptionStartedAt = performance.now();
        slog.info({ module: 'LOOP_CONTROLLER', event: 'OFFSCREEN_PERCEPTION_START', step_number: this.currentStep, status: 'started' });
        await ensureOffscreenDocument();
        const perceptionMsg = {
          type: 'RUN_PERCEPTION_CYCLE',
          screenshotDataUrl: captureResult.screenshotDataUrl,
          screenshotDims: { w: captureResult.width, h: captureResult.height },
          domElements: domSchema.elements,
          domSignals,
          piiSignals
        };
        let perceptionResult: any;
        try {
          perceptionResult = await sendMessageWithRetry(perceptionMsg);
          if (!perceptionResult) throw new Error('empty response');
          slog.info({ module: 'LOOP_CONTROLLER', event: 'OFFSCREEN_PERCEPTION_END', step_number: this.currentStep, duration_ms: Math.round(performance.now() - perceptionStartedAt), status: 'success', success: true });
        } catch {
          slog.error({ module: 'LOOP_CONTROLLER', event: 'OFFSCREEN_PERCEPTION_ERROR', step_number: this.currentStep, duration_ms: Math.round(performance.now() - perceptionStartedAt), error_code: 'PERCEPTION_FAILED', status: 'error', success: false });
          throw new Error('Perception failed');
        }
        
        if (!perceptionResult) {
            throw new Error('Perception cycle returned null');
        }

        // Build Sanitized Context (Offscreen)
        const buildMsg = {
          type: 'BUILD_SANITIZED_CONTEXT',
          input: {
            rawDataUrl: captureResult.screenshotDataUrl,
            rawSchema: domSchema,
            sensitivityMap: perceptionResult.sensitivityMap,
            dpr: captureResult.dpr,
            strictMode: true,
            stepNumber: this.currentStep,
            agentState: 'running',
            previousActionResult: this.previousResult
          }
        };
        const sanitizeStartedAt = performance.now();
        slog.info({ module: 'LOOP_CONTROLLER', event: 'SANITIZATION_START', step_number: this.currentStep, status: 'started' });
        let buildResult: any;
        try {
          buildResult = await sendMessageWithRetry(buildMsg);
          if (!buildResult || !buildResult.success) throw new Error('sanitization response failed');
          slog.info({ module: 'LOOP_CONTROLLER', event: 'SANITIZATION_END', step_number: this.currentStep, duration_ms: Math.round(performance.now() - sanitizeStartedAt), status: 'success', success: true });
        } catch {
          slog.error({ module: 'LOOP_CONTROLLER', event: 'SANITIZATION_ERROR', step_number: this.currentStep, duration_ms: Math.round(performance.now() - sanitizeStartedAt), error_code: 'SANITIZATION_FAILED', status: 'error', success: false });
          throw new Error('Sanitization failed');
        }
        
        sanitizedPayload = buildResult.payload;
        
      } catch (err) {
        const failureCode = err instanceof Error && err.message === 'Perception failed'
          ? 'PERCEPTION_FAILED'
          : err instanceof Error && err.message === 'Sanitization failed'
            ? 'SANITIZATION_FAILED'
            : 'CONTEXT_PREPARATION_FAILED';
        slog.error({
           module: 'LOOP_CONTROLLER',
           event: 'OFFSCREEN_PIPELINE_FAILED',
           error_code: failureCode,
        });
        slog.error({ module: 'LOOP_CONTROLLER', event: 'FAIL_CLOSED', message: 'Sanitization failed. Cannot send data.' });
        this.finish('agent_failed', failureCode);
        break;
      }

      this.transition('awaiting_action');
      const actionPromise = new Promise<ActionObject>((resolve, reject) => {
        const wait: PendingActionWait = {
          sessionId: this.wsClient.getSessionId(),
          stepNumber: this.currentStep,
          resolve,
          reject,
          timeout: setTimeout(() => {
            if (this.pendingActionWait !== wait) return;
            this.pendingActionWait = null;
            slog.warn({
              module: 'LOOP_CONTROLLER',
              event: 'ACTION_WAIT_TIMEOUT',
              session_id: wait.sessionId || undefined,
              step_number: wait.stepNumber,
              error_code: 'ACTION_TIMEOUT',
            });
            reject(new Error('Timed out waiting for agent action (300s)'));
          }, 300000),
        };
        this.pendingActionWait = wait;
      });

      this.wsClient.sendContextUpdate(sanitizedPayload);
      slog.info({ module: 'LOOP_CONTROLLER', event: 'CONTEXT_UPDATE_SEND', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, status: 'sent' });
      const action = await actionPromise;

      // ── Client-side validation ─────────────────────────────────────────────
      const validation = validateAction(action);
      slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_VALIDATION_DECISION', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, action_type: action.action_type, status: validation.valid ? 'valid' : 'invalid', error_code: validation.valid ? undefined : 'ACTION_INVALID' });
      if (!validation.valid) {
        slog.error({ module: 'LOOP_CONTROLLER', event: 'ACTION_VALIDATION_FAILED', message: validation.error });
        this.sendActionResultTracked({
          step_number: this.currentStep,
          action_type: action.action_type || 'unknown',
          success: false,
          error_code: 'E-VALIDATION',
          error_message: validation.error
        });
        this.finish('agent_failed');
        break;
      }

      // ── Client-side risk evaluation ────────────────────────────────────────
      const risk = evaluateActionRisk(action, domSchema);
      slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_RISK_DECISION', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, action_type: action.action_type, risk_category: risk.matchedCategory, status: risk.level });

      if (risk.level === 'blocked') {
        // BLOCKED: fail closed immediately — no confirmation, no execution
        slog.warn({
          module: 'LOOP_CONTROLLER',
          event: 'ACTION_BLOCKED',
          reason: risk.reason,
          category: risk.matchedCategory,
        });
        this.wsClient.sendActionDenied(
          this.currentStep,
          action.action_type,
          risk.matchedCategory || 'BLOCKED',
          'risk_engine_blocked',
        );
        this.finish('agent_failed');
        break;
      }

      if (risk.level === 'high_risk') {
        // HIGH_RISK: pause, request user confirmation
        slog.warn({
          module: 'LOOP_CONTROLLER',
          event: 'ACTION_HIGH_RISK_PENDING_CONFIRMATION',
          reason: risk.reason,
          category: risk.matchedCategory,
        });

        // Transition to confirming — popup will show Approve/Deny UI
        this.transition('confirming', {
          lastAction: action.action_type,
          confirmMeta: {
            actionType: action.action_type,
            target: action.target ?? null,
            riskReason: risk.reason ?? risk.matchedCategory ?? 'High-risk action',
          },
        });

        // Await user decision (popup sends CONFIRM_ACTION → sw.ts → handleConfirmation)
        const approved = await new Promise<boolean>((resolve) => {
          this.pendingConfirmResolver = resolve;
        });


        if (!approved) {
          // DENY: do not execute, report denied, end session
          slog.info({
            module: 'LOOP_CONTROLLER',
            event: 'CONFIRMATION_DENIED',
            step: this.currentStep,
          });
          this.wsClient.sendActionDenied(
            this.currentStep,
            action.action_type,
            risk.matchedCategory || 'HR-DENIED',
            'user_denied',
          );
          this.finish('agent_failed');
          break;
        }

        // APPROVE: perform live-DOM validation before execution
        slog.info({
          module: 'LOOP_CONTROLLER',
          event: 'CONFIRMATION_APPROVED_LIVE_DOM_CHECK',
          step: this.currentStep,
        });

        const liveValidation = await this.performLiveDomValidation(action, domSchema);
        if (!liveValidation.valid) {
          slog.warn({
            module: 'LOOP_CONTROLLER',
            event: 'LIVE_DOM_VALIDATION_FAILED',
            reason: liveValidation.reason,
            step: this.currentStep,
          });
          this.sendActionResultTracked({
            step_number: this.currentStep,
            action_type: action.action_type,
            success: false,
            error_code: 'E-STALE-TARGET',
            error_message: liveValidation.reason,
          });
          this.finish('agent_failed');
          break;
        }

        slog.info({
          module: 'LOOP_CONTROLLER',
          event: 'LIVE_DOM_VALIDATION_PASSED',
          step: this.currentStep,
        });
        // Fall through to execution below
      }

      // ── Terminal actions (done / fail) ─────────────────────────────────────
      this.transition('executing', { lastAction: action.action_type });

      if (action.action_type === 'done') {
        if (!this.previousResult?.success) {
          const result: ActionResultPayload = {
            step_number: this.currentStep,
            action_type: 'done',
            success: false,
            error_code: 'E-COMPLETION-UNVERIFIED',
            error_message: 'No successful browser action preceded completion',
          };
          this.sendActionResultTracked(result);
          this.finish('agent_failed');
          break;
        }
        const result: ActionResultPayload = {
          step_number: this.currentStep,
          action_type: 'done',
          success: true,
        };
        this.sendActionResultTracked(result);
        this.finish('goal_achieved');
        break;
      }

      if (action.action_type === 'fail') {
        const result: ActionResultPayload = {
          step_number: this.currentStep,
          action_type: 'fail',
          success: false,
          error_message: action.reasoning || 'Agent marked task failed',
        };
        this.sendActionResultTracked(result);
        this.finish('agent_failed', this.safeFailureCode(action.reasoning));
        break;
      }

      // ── Execute ────────────────────────────────────────────────────────────
      const executionStartedAt = performance.now();
      slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_EXECUTION_START', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, action_type: action.action_type, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, status: 'started' });
      const executionResult = await this.executeActionInActiveTab(action);
      slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_EXECUTION_END', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, action_type: action.action_type, duration_ms: Math.round(performance.now() - executionStartedAt), success: executionResult.success, error_code: executionResult.error_code, status: executionResult.success ? 'success' : 'failed' });
      this.previousResult = executionResult;

      this.sendActionResultTracked(executionResult);

      slog.info({
        module: 'LOOP_CONTROLLER',
        event: 'ACTION_RESULT_SENT',
        step_number: this.currentStep,
        success: executionResult.success,
      });

      if (!executionResult.success) {
        this.finish('agent_failed', executionResult.error_code ?? 'EXECUTION_FAILED');
        break;
      }

      this.currentStep++;
    }
  }

  /**
   * Live-DOM validation: re-query the active tab's current DOM to confirm
   * the target still exists, is visible, and is interactive before executing
   * a high-risk action the user just approved.
   *
   * Returns { valid: true } or { valid: false, reason: string }.
   */
  private async performLiveDomValidation(
    action: ActionObject,
    originalSchema: SanitizedSchema,
  ): Promise<{ valid: boolean; reason: string }> {
    const targetId = action.target;

    // Actions without a specific target (wait, scroll without target) are always valid
    if (!targetId) {
      return { valid: true, reason: '' };
    }

    // Re-extract live DOM
    let liveSchema: SanitizedSchema;
    try {
      const { schema } = await this.extractDomFromActiveTab();
      liveSchema = schema;
    } catch {
      return { valid: false, reason: 'Could not re-extract live DOM for validation' };
    }

    // 1. Target must still exist in current DOM
    const liveEl = liveSchema.elements.find((el) => el.id === targetId);
    if (!liveEl) {
      return { valid: false, reason: `Target element "${targetId}" no longer exists in live DOM (stale target)` };
    }

    // 2. Target must still be visible
    if (liveEl.isVisible === false) {
      return { valid: false, reason: `Target element "${targetId}" is no longer visible` };
    }

    // 3. Target must not be disabled
    if (liveEl.isDisabled === true) {
      return { valid: false, reason: `Target element "${targetId}" is disabled` };
    }

    // 4. Page URL must not have changed (prevents cross-page execution)
    if (originalSchema.url && liveSchema.url && originalSchema.url !== liveSchema.url) {
      return {
        valid: false,
        reason: `Page URL changed since action was proposed (was: ${originalSchema.url}, now: ${liveSchema.url})`,
      };
    }

    return { valid: true, reason: '' };
  }

  private sendActionResultTracked(result: ActionResultPayload): void {
    slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_RESULT_SEND', session_id: this.wsClient.getSessionId() || undefined, step_number: result.step_number, action_type: result.action_type, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${result.step_number}`, success: result.success, error_code: result.error_code, status: 'sending' });
    this.wsClient.sendActionResult(result);
  }

  private async extractDomFromActiveTab(): Promise<{ schema: SanitizedSchema; domSignals: any[]; piiSignals: any[] }> {
    const startedAt = performance.now();
    slog.info({ module: 'LOOP_CONTROLLER', event: 'DOM_EXTRACTION_START', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, status: 'started' });
    if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
      slog.error({ module: 'LOOP_CONTROLLER', event: 'DOM_EXTRACTION_END', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, duration_ms: Math.round(performance.now() - startedAt), element_count: 0, error_code: 'NO_ACTIVE_TAB', status: 'error' });
      throw new Error('E-DOM-NO-ACTIVE-TAB');
    }

    let extractionFailureCode = 'DOM_EXTRACTION_FAILED';
    try {
      const msg: ExtractDomRequestMessage = { type: 'EXTRACT_DOM_REQUEST' };
      let response: ExtractDomResponseMessage;
      try {
        response = (await chrome.tabs.sendMessage(this.activeTabId, msg)) as ExtractDomResponseMessage;
      } catch (err) {
        const errorText = err instanceof Error ? err.message : '';
        if (!errorText.includes('Receiving end does not exist')) throw err;

        // The extension can be loaded after a tab is already open. Inject its
        // declared content script once on demand, then retry DOM extraction.
        slog.info({
          module: 'LOOP_CONTROLLER',
          event: 'CONTENT_SCRIPT_INJECTION_START',
          session_id: this.wsClient.getSessionId() || undefined,
          step_number: this.currentStep,
          status: 'started',
        });
        try {
          if (!chrome.scripting?.executeScript) throw new Error('Scripting API unavailable');
          await chrome.scripting.executeScript({ target: { tabId: this.activeTabId }, files: ['content.js'] });
          response = (await chrome.tabs.sendMessage(this.activeTabId, msg)) as ExtractDomResponseMessage;
          slog.info({
            module: 'LOOP_CONTROLLER',
            event: 'CONTENT_SCRIPT_INJECTION_END',
            session_id: this.wsClient.getSessionId() || undefined,
            step_number: this.currentStep,
            status: 'success',
          });
        } catch {
          throw new Error('E-DOM-TAB-ACCESS-DENIED');
        }
      }
      if (response?.success === true && response.schema) {
        slog.info({ module: 'LOOP_CONTROLLER', event: 'DOM_EXTRACTION_END', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, duration_ms: Math.round(performance.now() - startedAt), element_count: response.schema.elements.length, status: 'success', success: true });
        return {
           schema: response.schema,
           domSignals: response.domSignals || [],
           piiSignals: response.piiSignals || []
        };
      }
      if (response && response.success === false) {
        throw new Error(`E-${response.errorCode || 'DOM_EXTRACTION_FAILED'}`);
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : '';
      const responseErrorCode = errorText.match(/^E-([A-Z0-9_-]+)$/)?.[1];
      const errorCode = responseErrorCode
        ? responseErrorCode
        : errorText === 'E-DOM-TAB-ACCESS-DENIED'
        ? 'TAB_ACCESS_DENIED'
        : errorText.includes('Receiving end does not exist')
        ? 'NO_CONTENT_SCRIPT'
        : errorText.includes('Cannot access contents')
          ? 'TAB_ACCESS_DENIED'
          : 'DOM_EXTRACTION_API_ERROR';
      extractionFailureCode = errorCode;
      slog.warn({
        module: 'LOOP_CONTROLLER',
        event: 'EXTRACT_DOM_FAILED',
        error_code: errorCode,
        status: 'error',
      });
    }

    slog.error({ module: 'LOOP_CONTROLLER', event: 'DOM_EXTRACTION_ERROR', session_id: this.wsClient.getSessionId() || undefined, step_number: this.currentStep, correlation_id: `${this.wsClient.getSessionId() || 'pending'}:${this.currentStep}`, duration_ms: Math.round(performance.now() - startedAt), element_count: 0, error_code: 'DOM_EXTRACTION_FAILED', status: 'error', success: false });
    throw new Error(`E-${extractionFailureCode}`);
  }


  private async executeActionInActiveTab(action: ActionObject): Promise<ActionResultPayload> {
    if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
      return {
        step_number: this.currentStep,
        action_type: action.action_type,
        success: false,
        error_code: 'E-EXEC-03',
        error_message: 'No active browser tab is available for execution',
      };
    }

    try {
      const msg: ExecuteActionRequestMessage = {
        type: 'EXECUTE_ACTION_REQUEST',
        action,
        stepNumber: this.currentStep,
      };
      const response = (await chrome.tabs.sendMessage(this.activeTabId, msg)) as ExecuteActionResponseMessage;
      if (response && response.result) {
        return response.result;
      }
    } catch (err) {
      slog.error({
        module: 'LOOP_CONTROLLER',
        event: 'EXECUTION_DISPATCH_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        step_number: this.currentStep,
        action_type: action.action_type,
        success: false,
        error_code: 'E-EXEC-02',
        error_message: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      step_number: this.currentStep,
      action_type: action.action_type,
      success: false,
      error_code: 'E-EXEC-03',
      error_message: 'Content script did not return an execution result',
    };
  }

  private safeFailureCode(reason?: string | null): string {
    if (!reason) return 'AGENT_ACTION_FAILED';
    const protocolCode = reason.match(/\bE-[A-Z0-9_-]+\b/);
    if (protocolCode) return protocolCode[0];
    const ollamaHttpCode = reason.match(/\bOLLAMA_HTTP_(\d{3})\b/);
    if (ollamaHttpCode) return `OLLAMA_HTTP_${ollamaHttpCode[1]}`;
    if (reason.includes('VLM timeout')) return 'VLM_TIMEOUT';
    if (reason.includes('Could not connect to local Ollama')) return 'OLLAMA_CONNECTION_FAILED';
    if (reason.includes('VLM HTTP request failed')) return 'OLLAMA_HTTP_FAILED';
    if (reason.includes('could not be safely parsed')) return 'VLM_RESPONSE_INVALID';
    if (reason.includes('valid browser action')) return 'VLM_ACTION_INVALID';
    if (reason.includes('Action validation failed')) return 'ACTION_VALIDATION_FAILED';
    if (reason.includes('Action blocked by risk engine')) return 'ACTION_BLOCKED';
    if (reason.includes('VLM generation failed')) return 'VLM_GENERATION_FAILED';
    if (reason === 'Perception failed') return 'PERCEPTION_FAILED';
    if (reason === 'Sanitization failed') return 'SANITIZATION_FAILED';
    return 'AGENT_ACTION_FAILED';
  }

  private finish(reason: SessionEndPayload['reason'], errorCode?: string): void {
    const finalStep = this.currentStep;
    try {
      this.wsClient.sendSessionEnd(reason, finalStep);
    } catch {
      slog.warn({ module: 'LOOP_CONTROLLER', event: 'SESSION_END_SEND_FAILED', error_code: 'SESSION_END_SEND_FAILED' });
    }
    this.rejectPendingSession(new Error('Session finished'));
    this.rejectPendingAction(new Error('Session finished'));
    this.wsClient.disconnect();

    if (reason === 'goal_achieved') {
      this.transition('completed');
    } else {
      this.transition('failed', {
        error: errorCode
          ? `Terminated with reason: ${reason} (${errorCode})`
          : `Terminated with reason: ${reason}`,
      });
    }
  }

  private rejectPendingSession(error: Error): void {
    const wait = this.pendingSessionWait;
    if (!wait) return;
    this.pendingSessionWait = null;
    clearTimeout(wait.timeout);
    wait.reject(error);
  }

  private rejectPendingAction(error: Error): void {
    const wait = this.pendingActionWait;
    if (!wait) return;
    this.pendingActionWait = null;
    clearTimeout(wait.timeout);
    wait.reject(error);
  }

  private transition(
    newState: LoopState,
    meta: { lastAction?: string; reasoning?: string; error?: string; confirmMeta?: ConfirmationMeta } = {},
  ): void {
    this.state = newState;
    const update: SessionStateUpdateMessage = {
      type: 'SESSION_STATE_UPDATE',
      state:
        newState === 'completed'
          ? 'completed'
          : newState === 'failed'
            ? 'failed'
            : newState === 'cancelled'
              ? 'cancelled'
              : newState === 'idle'
                ? 'idle'
                : newState === 'confirming'
                  ? 'confirming'
                  : 'running',
      step: this.currentStep,
      maxSteps: this.maxSteps,
      lastAction: meta.lastAction,
      reasoning: meta.reasoning,
      error: meta.error,
      confirmMeta: meta.confirmMeta,
    };

    this.onStateChange?.(update);
  }
}
