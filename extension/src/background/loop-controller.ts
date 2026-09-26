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
  DetailedState,
  ExecuteActionRequestMessage,
  ExecuteActionResponseMessage,
  ExtractDomRequestMessage,
  ExtractDomResponseMessage,
  PendingConfirmation,
  ProviderInfo,
  SessionStateUpdateMessage,
} from './bus';

export type LoopState =
  | 'idle'
  | 'starting'
  | 'capturing'
  | 'sanitizing'
  | 'awaiting_action'
  | 'awaiting_confirmation'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LoopControllerOptions {
  serverUrl?: string;
  maxSteps?: number;
  onStateChange?: (update: SessionStateUpdateMessage) => void;
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

  // Confirmation flow
  private pendingConfirmationAction: ActionObject | null = null;
  private pendingConfirmationRisk: { category: string; reason: string } | null = null;
  private confirmationResolver: ((approved: boolean) => void) | null = null;

  // Provider info from server
  private providerInfo: ProviderInfo | null = null;

  constructor(options: LoopControllerOptions = {}) {
    this.maxSteps = options.maxSteps || 30;
    this.onStateChange = options.onStateChange;
    this.wsClient = new AegisWebSocketClient(options.serverUrl || 'ws://127.0.0.1:8765/ws');

    this.wsClient.setCallbacks({
      onSessionCreated: (msg) => {
        // Extract provider info from session_created if available
        const payload = msg.payload as any;
        if (payload.provider_name) {
          this.providerInfo = {
            providerName: payload.provider_name,
            modelName: payload.model_name,
            isMock: payload.is_mock === true,
          };
        }

        if (this.pendingSessionResolver) {
          this.pendingSessionResolver(msg);
          this.pendingSessionResolver = null;
        }
      },
      onAction: (msg: ActionMessage) => {
        // Extract provider info from action response if available
        const payload = msg.payload as any;
        if (payload.provider_name) {
          this.providerInfo = {
            providerName: payload.provider_name,
            modelName: payload.model_name,
            isMock: payload.is_mock === true,
          };
        }

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

  /** Called when the user approves a high-risk action. */
  public confirmAction(): void {
    if (this.confirmationResolver) {
      this.confirmationResolver(true);
      this.confirmationResolver = null;
    }
  }

  /** Called when the user denies a high-risk action. */
  public denyAction(): void {
    if (this.confirmationResolver) {
      this.confirmationResolver(false);
      this.confirmationResolver = null;
    }
  }

  public async start(goal: string, targetTabId?: number): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'completed' && this.state !== 'failed' && this.state !== 'cancelled') {
      throw new Error(`Cannot start loop while in state "${this.state}"`);
    }

    this.goal = goal;
    this.currentStep = 0;
    this.previousResult = null;
    this.pendingConfirmationAction = null;
    this.pendingConfirmationRisk = null;
    this.confirmationResolver = null;
    this.providerInfo = null;
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

    // Reject any pending confirmation
    if (this.confirmationResolver) {
      this.confirmationResolver(false);
      this.confirmationResolver = null;
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
        
        // Fail closed: sanitization failure prevents transmission
        slog.error({ module: 'LOOP_CONTROLLER', event: 'FAIL_CLOSED', message: 'Sanitization failed. Cannot send data.' });
        this.transition('failed', { error: 'Sanitization failed — data not transmitted' });
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
        }, 120000);
      });

      this.wsClient.sendContextUpdate(sanitizedPayload);
      let action: ActionObject;
      try {
        action = await actionPromise;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        slog.error({ module: 'LOOP_CONTROLLER', event: 'ACTION_WAIT_FAILED', message });
        this.transition('failed', { error: message });
        break;
      }

      slog.info({
        module: 'LOOP_CONTROLLER',
        event: 'ACTION_RECEIVED',
        step_number: this.currentStep,
        action_type: action.action_type,
      });

      // Validate action
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

      // Risk assessment
      const risk = evaluateActionRisk(action, domSchema);

      // BLOCKED → never execute
      if (risk.level === 'blocked') {
        slog.warn({ module: 'LOOP_CONTROLLER', event: 'ACTION_BLOCKED_BY_RISK_ENGINE', reason: risk.reason });
        this.wsClient.sendActionDenied(this.currentStep, action.action_type, risk.matchedCategory || 'HR-UNKNOWN', 'risk_engine_blocked');
        this.transition('failed', {
          error: `Action blocked: ${risk.reason}`,
          lastAction: action.action_type,
        });
        this.finish('agent_failed');
        break;
      }

      // HIGH-RISK → ask user for confirmation
      if (risk.level === 'high_risk') {
        slog.info({
          module: 'LOOP_CONTROLLER',
          event: 'ACTION_REQUIRES_CONFIRMATION',
          action_type: action.action_type,
          risk_category: risk.matchedCategory,
        });

        this.pendingConfirmationAction = action;
        this.pendingConfirmationRisk = {
          category: risk.matchedCategory || 'HR-UNKNOWN',
          reason: risk.reason || 'High-risk action detected',
        };

        this.transition('awaiting_confirmation', {
          lastAction: action.action_type,
          reasoning: action.reasoning || undefined,
        });

        // Wait for user decision
        const approved = await new Promise<boolean>((resolve) => {
          this.confirmationResolver = resolve;
          // Safety timeout: auto-deny after 60 seconds
          setTimeout(() => {
            if (this.confirmationResolver) {
              slog.warn({ module: 'LOOP_CONTROLLER', event: 'CONFIRMATION_TIMEOUT', step: this.currentStep });
              this.confirmationResolver = null;
              resolve(false);
            }
          }, 60000);
        });

        this.pendingConfirmationAction = null;
        this.pendingConfirmationRisk = null;

        if (!approved) {
          slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_DENIED_BY_USER', step: this.currentStep });
          this.wsClient.sendActionDenied(this.currentStep, action.action_type, risk.matchedCategory || 'HR-UNKNOWN', 'user');
          this.finish('agent_failed');
          break;
        }

        slog.info({ module: 'LOOP_CONTROLLER', event: 'ACTION_APPROVED_BY_USER', step: this.currentStep });
      }

      // Execute the action
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
      this.transition('failed', { error: `Terminated: ${reason}` });
    }
  }

  private mapToDetailedState(loopState: LoopState): DetailedState {
    switch (loopState) {
      case 'idle': return 'idle';
      case 'starting': return 'starting';
      case 'capturing': return 'capturing';
      case 'sanitizing': return 'sanitizing';
      case 'awaiting_action': return 'awaiting_action';
      case 'awaiting_confirmation': return 'awaiting_confirmation';
      case 'executing': return 'executing';
      case 'completed': return 'completed';
      case 'failed': return 'failed';
      case 'cancelled': return 'cancelled';
      default: return 'idle';
    }
  }

  private mapToHighLevelState(loopState: LoopState): 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' {
    switch (loopState) {
      case 'idle': return 'idle';
      case 'completed': return 'completed';
      case 'failed': return 'failed';
      case 'cancelled': return 'cancelled';
      case 'awaiting_confirmation': return 'paused';
      default: return 'running';
    }
  }

  private transition(
    newState: LoopState,
    meta: { lastAction?: string; reasoning?: string; error?: string } = {},
  ): void {
    this.state = newState;

    let pendingConfirmation: PendingConfirmation | null = null;
    if (newState === 'awaiting_confirmation' && this.pendingConfirmationAction && this.pendingConfirmationRisk) {
      pendingConfirmation = {
        actionType: this.pendingConfirmationAction.action_type,
        target: this.pendingConfirmationAction.target,
        reasoning: this.pendingConfirmationAction.reasoning,
        riskCategory: this.pendingConfirmationRisk.category,
        riskReason: this.pendingConfirmationRisk.reason,
      };
    }

    const update: SessionStateUpdateMessage = {
      type: 'SESSION_STATE_UPDATE',
      state: this.mapToHighLevelState(newState),
      detailedState: this.mapToDetailedState(newState),
      step: this.currentStep,
      maxSteps: this.maxSteps,
      lastAction: meta.lastAction,
      reasoning: meta.reasoning,
      error: meta.error,
      pendingConfirmation,
      providerInfo: this.providerInfo,
    };

    this.onStateChange?.(update);
  }
}
