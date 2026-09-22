/**
 * AEGIS Action Executor (Work Package B6)
 * Source of Truth: docs/BROWSER_AGENT_SPEC.md §5, docs/IMPLEMENTATION_PLAN.md B6
 * Executes closed-vocabulary actions (click, type, scroll, select, hover, wait, done, fail)
 * using native property setters and standard DOM event dispatching.
 */
import type { ActionObject, ActionResultPayload } from '@aegis/protocol';
export declare function executeAction(action: ActionObject, stepNumber: number): Promise<ActionResultPayload>;
//# sourceMappingURL=executor.d.ts.map