/**
 * AEGIS Loop Controller State Machine (Work Package B5)
 * Source of Truth: docs/BROWSER_AGENT_SPEC.md §3.2, §9, docs/TECHNICAL_SPEC.md §3
 *
 * Coordinates the perception-action loop:
 * CAPTURE -> MINIMAL SANITIZED CONTEXT -> WEBSOCKET SEND -> AWAIT ACTION -> EXECUTE -> RESULT -> NEXT CYCLE
 */
import { slog } from '@aegis/shared';
import { captureActiveTab } from './capture';
import { buildMinimalSanitizedContext } from './context-builder';
import { AegisWebSocketClient } from './ws-client';
export class LoopController {
    state = 'idle';
    currentStep = 0;
    maxSteps = 30;
    goal = '';
    activeTabId = null;
    previousResult = null;
    wsClient;
    onStateChange;
    pendingActionResolver = null;
    pendingSessionResolver = null;
    constructor(options = {}) {
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
            onAction: (msg) => {
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
    getState() {
        return this.state;
    }
    getCurrentStep() {
        return this.currentStep;
    }
    getMaxSteps() {
        return this.maxSteps;
    }
    getSessionId() {
        return this.wsClient.getSessionId();
    }
    async start(goal, targetTabId) {
        if (this.state !== 'idle' && this.state !== 'completed' && this.state !== 'failed' && this.state !== 'cancelled') {
            throw new Error(`Cannot start loop while in state "${this.state}"`);
        }
        this.goal = goal;
        this.currentStep = 0;
        this.previousResult = null;
        this.transition('starting');
        // Identify active tab
        if (targetTabId) {
            this.activeTabId = targetTabId;
        }
        else if (typeof chrome !== 'undefined' && chrome.tabs) {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            this.activeTabId = tabs[0]?.id || null;
        }
        try {
            await this.wsClient.connect();
            const clientMeta = {
                extension_version: '1.0.0',
                browser: 'chrome',
                browser_version: '120.0',
                max_steps: this.maxSteps,
            };
            const sessionCreatedPromise = new Promise((resolve, reject) => {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            slog.error({
                module: 'LOOP_CONTROLLER',
                event: 'LOOP_START_FAILED',
                message,
            });
            this.transition('failed', { error: message });
        }
    }
    cancel() {
        if (this.state === 'idle' || this.state === 'completed' || this.state === 'cancelled')
            return;
        slog.info({
            module: 'LOOP_CONTROLLER',
            event: 'SESSION_CANCELLED',
            step: this.currentStep,
        });
        this.wsClient.sendSessionEnd('user_cancelled', this.currentStep);
        this.wsClient.disconnect();
        this.transition('cancelled');
    }
    async runLoop() {
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
            // 1. Capture active tab
            this.transition('capturing');
            const captureResult = await captureActiveTab(this.activeTabId || undefined);
            // 2. Extract DOM schema from content script
            const domSchema = await this.extractDomFromActiveTab();
            // 3. Build minimal sanitized context (preserving compile-time Sanitized<T> boundary)
            this.transition('sanitizing');
            const sanitizedPayload = buildMinimalSanitizedContext(this.currentStep, domSchema, captureResult, this.previousResult);
            // 4. Transmit context_update over WebSocket
            this.transition('awaiting_action');
            const actionPromise = new Promise((resolve, reject) => {
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
            this.transition('executing', {
                lastAction: action.action_type,
                reasoning: action.reasoning || undefined,
            });
            // 5. Handle terminal actions or dispatch to executor
            if (action.action_type === 'done') {
                const result = {
                    step_number: this.currentStep,
                    action_type: 'done',
                    success: true,
                };
                this.wsClient.sendActionResult(result);
                this.finish('goal_achieved');
                break;
            }
            if (action.action_type === 'fail') {
                const result = {
                    step_number: this.currentStep,
                    action_type: 'fail',
                    success: false,
                    error_message: action.reasoning || 'Agent marked task failed',
                };
                this.wsClient.sendActionResult(result);
                this.finish('agent_failed');
                break;
            }
            // 6. Execute action in content script
            const executionResult = await this.executeActionInActiveTab(action);
            this.previousResult = executionResult;
            // 7. Send action_result back to server
            this.wsClient.sendActionResult(executionResult);
            slog.info({
                module: 'LOOP_CONTROLLER',
                event: 'ACTION_RESULT_SENT',
                step_number: this.currentStep,
                success: executionResult.success,
            });
            // Advance to next cycle
            this.currentStep++;
        }
    }
    async extractDomFromActiveTab() {
        if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
            // Fallback empty schema if no tab attached
            return { url: 'http://localhost/fixtures/fp_01.html', title: 'FP-01 Fixture', elements: [] };
        }
        try {
            const msg = { type: 'EXTRACT_DOM_REQUEST' };
            const response = (await chrome.tabs.sendMessage(this.activeTabId, msg));
            if (response && response.schema) {
                return response.schema;
            }
        }
        catch (err) {
            slog.warn({
                module: 'LOOP_CONTROLLER',
                event: 'EXTRACT_DOM_FAILED',
                message: err instanceof Error ? err.message : String(err),
            });
        }
        return { url: 'http://localhost/fixtures/fp_01.html', title: 'FP-01 Fixture', elements: [] };
    }
    async executeActionInActiveTab(action) {
        if (!this.activeTabId || typeof chrome === 'undefined' || !chrome.tabs) {
            return {
                step_number: this.currentStep,
                action_type: action.action_type,
                success: true,
            };
        }
        try {
            const msg = {
                type: 'EXECUTE_ACTION_REQUEST',
                action,
                stepNumber: this.currentStep,
            };
            const response = (await chrome.tabs.sendMessage(this.activeTabId, msg));
            if (response && response.result) {
                return response.result;
            }
        }
        catch (err) {
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
    finish(reason) {
        const finalStep = this.currentStep;
        this.wsClient.sendSessionEnd(reason, finalStep);
        this.wsClient.disconnect();
        if (reason === 'goal_achieved') {
            this.transition('completed');
        }
        else {
            this.transition('failed', { error: `Terminated with reason: ${reason}` });
        }
    }
    transition(newState, meta = {}) {
        this.state = newState;
        const update = {
            type: 'SESSION_STATE_UPDATE',
            state: newState === 'completed'
                ? 'completed'
                : newState === 'failed'
                    ? 'failed'
                    : newState === 'cancelled'
                        ? 'cancelled'
                        : newState === 'idle'
                            ? 'idle'
                            : 'running',
            step: this.currentStep,
            maxSteps: this.maxSteps,
            lastAction: meta.lastAction,
            reasoning: meta.reasoning,
            error: meta.error,
        };
        this.onStateChange?.(update);
    }
}
//# sourceMappingURL=loop-controller.js.map