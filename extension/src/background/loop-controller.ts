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
import { slog } from '@aegis/shared';
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

async function sendMessageWithRetry<T = any>(message: any, maxRetries = 15, delayMs = 200): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime not available');
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response !== undefined) {
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

  private pendingActionResolver: ((action: ActionObject) => void) | null = null;
  private pendingSessionResolver: ((session: SessionCreatedMessage) => void) | null = null;

  // Confirmation flow: resolve = user responded (true=approved, false=denied)
  private pendingConfirmResolver: ((approved: boolean) => void) | null = null;

  constructor(options: LoopControllerOptions = {}) {
    this.maxSteps = options.maxSteps || 30;
    this.onStateChange = options.onStateChange;
    this.wsClient = new AegisWebSocketClient(options.serverUrl || 'ws://127.0.0.1:8765/ws');

    this.wsClient.setCallbacks({
      onSessionCreated: (msg) => {
        if (this.pendingSessionResolver) {
          this.pendingSessionResolver(msg);
          this.pendingSessionResolver = null;
        }
      },
      onAction: (msg: ActionMessage) => {
        if (this.pendingActionResolver) {
          this.pendingActionResolver(msg.payload.action);
          this.pendingActionResolver = null;
        }
      },
      onSessionError: (msg) => {
        slog.error({
          module: 'LOOP_CONTROLLER',
          event: 'SERVER_ERROR_RECEIVED',
          code: msg.payload.error_code,
          message: msg.payload.error_message,
        });
      },
      onClose: () => {
        if (this.state !== 'completed' && this.state !== 'cancelled' && this.state !== 'idle') {
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

    this.goal = goal;
    this.currentStep = 0;
    this.previousResult = null;
    this.transition('starting');

    if (targetTabId) {
      this.activeTabId = targetTabId;
    } else if (typeof chrome !== 'undefined' && chrome.tabs) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      this.activeTabId = tabs[0]?.id || null;
    }

    try {
      await this.wsClient.connect();

      const clientMeta: ClientMetadata = {
        extension_version: '1.0.0',
        browser: 'chrome',
        browser_version: '120.0',
        max_steps: this.maxSteps,
      };

      const sessionCreatedPromise = new Promise<SessionCreatedMessage>((resolve, reject) => {
        this.pendingSessionResolver = resolve;
        setTimeout(() => {
          if (this.pendingSessionResolver) {
            this.pendingSessionResolver = null;
            reject(new Error('Timed out waiting for session_created'));
          }
        }, 10000);
      });

      this.wsClient.sendSessionInit(this.goal, clientMeta);
      const sessionCreated = await sessionCreatedPromise;
      if (sessionCreated.payload.server_max_steps) {
        this.maxSteps = sessionCreated.payload.server_max_steps;
      }

      this.currentStep = 1;
      await this.runLoop();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[LOOP_START_FAILED ERROR]', err);
      slog.error({
        module: 'LOOP_CONTROLLER',
        event: 'LOOP_START_FAILED',
        message,
      });
      this.transition('failed', { error: message });
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

    this.wsClient.sendSessionEnd('user_cancelled', this.currentStep);
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
        event: 'STEP_CYCLE_START',
        step_number: this.currentStep,
      });

      this.transition('capturing');
      const captureResult = await captureActiveTab(this.activeTabId || undefined);

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
        await ensureOffscreenDocument();
        const perceptionMsg = {
          type: 'RUN_PERCEPTION_CYCLE',
          screenshotDataUrl: captureResult.screenshotDataUrl,
          screenshotDims: { w: captureResult.width, h: captureResult.height },
          domElements: domSchema.elements,
          domSignals,
          piiSignals
        };
        const perceptionResult = await sendMessageWithRetry(perceptionMsg);
        
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
        const buildResult = await sendMessageWithRetry(buildMsg);
        
        if (!buildResult || !buildResult.success) {
            throw new Error(buildResult?.error || 'Build context failed');
        }
        
        sanitizedPayload = buildResult.payload;
        
      } catch (err) {
        slog.error({
           module: 'LOOP_CONTROLLER',
           event: 'OFFSCREEN_PIPELINE_FAILED',
           message: err instanceof Error ? err.message : String(err)
        });
        slog.error({ module: 'LOOP_CONTROLLER', event: 'FAIL_CLOSED', message: 'Sanitization failed. Cannot send data.' });
        this.transition('failed', { error: 'Sanitization failed' });
        break;
      }

      this.transition('awaiting_action');
      const actionPromise = new Promise<ActionObject>((resolve, reject) => {
        this.pendingActionResolver = resolve;
        setTimeout(() => {
          if (this.pendingActionResolver) {
            this.pendingActionResolver = null;
            reject(new Error('Timed out waiting for agent action'));
          }
        }, 30000);
      });

      this.wsClient.sendContextUpdate(sanitizedPayload);
      const action = await actionPromise;

      slog.info({
        module: 'LOOP_CONTROLLER',
        event: 'ACTION_RECEIVED',
        step_number: this.currentStep,
        action_type: action.action_type,
      });

      // ── Client-side validation ─────────────────────────────────────────────
      const validation = validateAction(action);
      if (!validation.valid) {
        slog.error({ module: 'LOOP_CONTROLLER', event: 'ACTION_VALIDATION_FAILED', message: validation.error });
        this.wsClient.sendActionResult({
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
          this.wsClient.sendActionResult({
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
      this.transition('executing', {
        lastAction: action.action_type,
        reasoning: action.reasoning || undefined,
      });

      if (action.action_type === 'done') {
        const result: ActionResultPayload = {
          step_number: this.currentStep,
          action_type: 'done',
          success: true,
        };
        this.wsClient.sendActionResult(result);
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
        this.wsClient.sendActionResult(result);
        this.finish('agent_failed');
        break;
      }

      // ── Execute ────────────────────────────────────────────────────────────
      const executionResult = await this.executeActionInActiveTab(action);
      this.previousResult = executionResult;

      this.wsClient.sendActionResult(executionResult);

      slog.info({
        module: 'LOOP_CONTROLLER',
        event: 'ACTION_RESULT_SENT',
        step_number: this.currentStep,
        success: executionResult.success,
      });

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

  private async extractDomFromActiveTab(): Promise<{ schema: SanitizedSchema; domSignals: any[]; piiSignals: any[] }> {
    if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
      return { schema: { url: 'http://localhost/fixtures/fp_01.html', title: 'FP-01 Fixture', elements: [] } as any, domSignals: [], piiSignals: [] };
    }

    try {
      const msg: ExtractDomRequestMessage = { type: 'EXTRACT_DOM_REQUEST' };
      const response = (await chrome.tabs.sendMessage(this.activeTabId, msg)) as ExtractDomResponseMessage;
      if (response && response.schema) {
        return {
           schema: response.schema,
           domSignals: response.domSignals || [],
           piiSignals: response.piiSignals || []
        };
      }
    } catch (err) {
      slog.warn({
        module: 'LOOP_CONTROLLER',
        event: 'EXTRACT_DOM_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return { schema: { url: 'http://localhost/fixtures/fp_01.html', title: 'FP-01 Fixture', elements: [] } as any, domSignals: [], piiSignals: [] };
  }


  private async executeActionInActiveTab(action: ActionObject): Promise<ActionResultPayload> {
    if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
      return {
        step_number: this.currentStep,
        action_type: action.action_type,
        success: true,
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
      success: true,
    };
  }

  private finish(reason: SessionEndPayload['reason']): void {
    const finalStep = this.currentStep;
    this.wsClient.sendSessionEnd(reason, finalStep);
    this.wsClient.disconnect();

    if (reason === 'goal_achieved') {
      this.transition('completed');
    } else {
      this.transition('failed', { error: `Terminated with reason: ${reason}` });
    }
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
