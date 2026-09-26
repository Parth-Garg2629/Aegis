import type { ActionObject, ActionResultPayload, SanitizedSchema } from '@aegis/protocol';

export type BusMessageType =
  | 'START_SESSION'
  | 'CANCEL_SESSION'
  | 'GET_SESSION_STATE'
  | 'SESSION_STATE_UPDATE'
  | 'CONFIRM_ACTION'
  | 'DENY_ACTION'
  | 'EXTRACT_DOM_REQUEST'
  | 'EXTRACT_DOM_RESPONSE'
  | 'EXECUTE_ACTION_REQUEST'
  | 'EXECUTE_ACTION_RESPONSE';

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

/** Detailed state visible to the popup for fine-grained UX feedback. */
export type DetailedState =
  | 'idle'
  | 'connecting'
  | 'starting'
  | 'capturing'
  | 'analyzing'
  | 'sanitizing'
  | 'awaiting_action'
  | 'awaiting_confirmation'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reconnecting'
  | 'blocked';

/** Information about a pending high-risk action awaiting user confirmation. */
export interface PendingConfirmation {
  actionType: string;
  target?: string | null;
  reasoning?: string | null;
  riskCategory: string;
  riskReason: string;
}

/** Provider status information for transparency. */
export interface ProviderInfo {
  providerName?: string;
  modelName?: string;
  isMock?: boolean;
}

export interface SessionStateUpdateMessage {
  type: 'SESSION_STATE_UPDATE';
  state: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  detailedState: DetailedState;
  step: number;
  maxSteps: number;
  lastAction?: string;
  reasoning?: string;
  error?: string;
  pendingConfirmation?: PendingConfirmation | null;
  providerInfo?: ProviderInfo | null;
}

/** User approves a pending high-risk action. */
export interface ConfirmActionMessage {
  type: 'CONFIRM_ACTION';
}

/** User denies a pending high-risk action. */
export interface DenyActionMessage {
  type: 'DENY_ACTION';
}

export interface ExtractDomRequestMessage {
  type: 'EXTRACT_DOM_REQUEST';
}

export interface ExtractDomResponseMessage {
  type: 'EXTRACT_DOM_RESPONSE';
  schema: SanitizedSchema;
  elementsCount: number;
  domSignals: any[];
  piiSignals: any[];
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

export type BusMessage =
  | StartSessionMessage
  | CancelSessionMessage
  | GetSessionStateMessage
  | SessionStateUpdateMessage
  | ConfirmActionMessage
  | DenyActionMessage
  | ExtractDomRequestMessage
  | ExtractDomResponseMessage
  | ExecuteActionRequestMessage
  | ExecuteActionResponseMessage;
