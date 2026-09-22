/**
 * AEGIS Loop Controller State Machine (Work Package B5)
 * Source of Truth: docs/BROWSER_AGENT_SPEC.md §3.2, §9, docs/TECHNICAL_SPEC.md §3
 *
 * Coordinates the perception-action loop:
 * CAPTURE -> MINIMAL SANITIZED CONTEXT -> WEBSOCKET SEND -> AWAIT ACTION -> EXECUTE -> RESULT -> NEXT CYCLE
 */
import type { SessionStateUpdateMessage } from './bus';
export type LoopState = 'idle' | 'starting' | 'capturing' | 'sanitizing' | 'awaiting_action' | 'executing' | 'completed' | 'failed' | 'cancelled';
export interface LoopControllerOptions {
    serverUrl?: string;
    maxSteps?: number;
    onStateChange?: (update: SessionStateUpdateMessage) => void;
}
export declare class LoopController {
    private state;
    private currentStep;
    private maxSteps;
    private goal;
    private activeTabId;
    private previousResult;
    private wsClient;
    private onStateChange?;
    private pendingActionResolver;
    private pendingSessionResolver;
    constructor(options?: LoopControllerOptions);
    getState(): LoopState;
    getCurrentStep(): number;
    getMaxSteps(): number;
    getSessionId(): string | null;
    start(goal: string, targetTabId?: number): Promise<void>;
    cancel(): void;
    private runLoop;
    private extractDomFromActiveTab;
    private executeActionInActiveTab;
    private finish;
    private transition;
}
//# sourceMappingURL=loop-controller.d.ts.map