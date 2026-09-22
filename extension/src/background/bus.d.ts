/**
 * AEGIS Service Worker Internal Message Bus (Work Package B1)
 * Facilitates typed message exchange between Popup, Service Worker, and Content Script.
 */
import type { ActionObject, ActionResultPayload, SanitizedSchema } from '@aegis/protocol';
export type BusMessageType = 'START_SESSION' | 'CANCEL_SESSION' | 'GET_SESSION_STATE' | 'SESSION_STATE_UPDATE' | 'EXTRACT_DOM_REQUEST' | 'EXTRACT_DOM_RESPONSE' | 'EXECUTE_ACTION_REQUEST' | 'EXECUTE_ACTION_RESPONSE';
export interface StartSessionMessage {
    type: 'START_SESSION';
    goal: string;
}
export interface CancelSessionMessage {
    type: 'CANCEL_SESSION';
}
export interface GetSessionStateMessage {
    type: 'GET_SESSION_STATE';
}
export interface SessionStateUpdateMessage {
    type: 'SESSION_STATE_UPDATE';
    state: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    step: number;
    maxSteps: number;
    lastAction?: string;
    reasoning?: string;
    error?: string;
}
export interface ExtractDomRequestMessage {
    type: 'EXTRACT_DOM_REQUEST';
}
export interface ExtractDomResponseMessage {
    type: 'EXTRACT_DOM_RESPONSE';
    schema: SanitizedSchema;
    elementsCount: number;
}
export interface ExecuteActionRequestMessage {
    type: 'EXECUTE_ACTION_REQUEST';
    action: ActionObject;
    stepNumber: number;
}
export interface ExecuteActionResponseMessage {
    type: 'EXECUTE_ACTION_RESPONSE';
    result: ActionResultPayload;
}
export type BusMessage = StartSessionMessage | CancelSessionMessage | GetSessionStateMessage | SessionStateUpdateMessage | ExtractDomRequestMessage | ExtractDomResponseMessage | ExecuteActionRequestMessage | ExecuteActionResponseMessage;
//# sourceMappingURL=bus.d.ts.map