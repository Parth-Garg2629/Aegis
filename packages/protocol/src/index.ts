export type MessageType =
  | 'session_init'
  | 'context_update'
  | 'session_resume'
  | 'session_end'
  | 'action_denied'
  | 'action_result'
  | 'ping'
  | 'session_created'
  | 'action'
  | 'session_error'
  | 'session_resumed'
  | 'pong';

export interface MessageEnvelope<T = unknown> {
  type: MessageType;
  session_id: string | null;
  timestamp: string;
  protocol_version: '1.0';
  payload: T;
}

export interface ClientMetadata {
  extension_version: string;
  browser: 'chrome' | 'edge';
  browser_version: string;
  max_steps: number;
}

export interface SessionInitPayload {
  goal: string;
  client_metadata: ClientMetadata;
}
export type SessionInitMessage = MessageEnvelope<SessionInitPayload> & {
  type: 'session_init';
  session_id: null;
};

export interface SessionCreatedPayload {
  server_max_steps: number;
}
export type SessionCreatedMessage = MessageEnvelope<SessionCreatedPayload> & {
  type: 'session_created';
  session_id: string;
};

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SanitizedElement {
  id: string;
  tagName: string;
  type?: string | null;
  role?: string | null;
  label?: string | null;
  text?: string | null;
  value?: string | null;
  boundingBox: BoundingBox;
  isVisible: boolean;
  isDisabled: boolean;
  isReadOnly: boolean;
  isInteractive: boolean;
  parentFormId?: string | null;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface SanitizedForm {
  id: string;
  action?: string | null;
  method?: 'GET' | 'POST' | 'get' | 'post' | null;
  elementIds: string[];
}

export interface SanitizedSchema {
  url: string;
  title: string;
  elements: SanitizedElement[];
  forms?: SanitizedForm[];
}

export interface PreviousActionResult {
  action_type: string;
  target_element_id?: string | null;
  success: boolean;
  error_code?: string | null;
  error_message?: string | null;
  local_input_status?: 'LOCAL_INPUT_PROVIDED' | 'LOCAL_INPUT_CANCELLED' | null;
}

export interface ContextUpdatePayload {
  step_number: number;
  agent_state: 'running' | 'paused' | 'confirming';
  sanitized_screenshot: string;
  screenshot_format: 'webp' | 'jpeg';
  sanitized_schema: SanitizedSchema;
  previous_action_result: PreviousActionResult | null;
}
export type ContextUpdateMessage = MessageEnvelope<ContextUpdatePayload> & {
  type: 'context_update';
  session_id: string;
};

export type ActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'select'
  | 'hover'
  | 'wait'
  | 'done'
  | 'fail';

export interface ActionObject {
  action_type: ActionType;
  target?: string | null;
  value?: string | null;
  reasoning?: string | null;
}

export interface ActionPayload {
  step_number: number;
  action: ActionObject;
}
export type ActionMessage = MessageEnvelope<ActionPayload> & {
  type: 'action';
  session_id: string;
};

export interface ActionResultPayload {
  step_number: number;
  action_type: string;
  success: boolean;
  error_code?: string | null;
  error_message?: string | null;
  local_input_status?: 'LOCAL_INPUT_PROVIDED' | 'LOCAL_INPUT_CANCELLED' | null;
}
export type ActionResultMessage = MessageEnvelope<ActionResultPayload> & {
  type: 'action_result';
  session_id: string;
};

export interface ActionDeniedPayload {
  step_number: number;
  denied_action_type: string;
  risk_category: string;
  denial_source: 'user' | 'risk_engine_blocked';
}
export type ActionDeniedMessage = MessageEnvelope<ActionDeniedPayload> & {
  type: 'action_denied';
  session_id: string;
};

export interface SessionResumePayload {
  last_known_step: number;
}
export type SessionResumeMessage = MessageEnvelope<SessionResumePayload> & {
  type: 'session_resume';
  session_id: string;
};

export interface SessionResumedPayload {
  resumed: boolean;
  server_step?: number | null;
  reason?: string | null;
}
export type SessionResumedMessage = MessageEnvelope<SessionResumedPayload> & {
  type: 'session_resumed';
  session_id: string;
};

export type SessionEndReason =
  | 'goal_achieved'
  | 'agent_failed'
  | 'user_cancelled'
  | 'max_steps_reached'
  | 'stuck_detected'
  | 'repeated_failures'
  | 'connection_error';

export interface SessionEndPayload {
  reason: SessionEndReason;
  final_step: number;
}
export type SessionEndMessage = MessageEnvelope<SessionEndPayload> & {
  type: 'session_end';
  session_id: string;
};

export interface SessionErrorPayload {
  error_code: string;
  error_message: string;
  recoverable: boolean;
  suggested_action?: 'retry' | 'reconnect' | 'terminate' | null;
}
export type SessionErrorMessage = MessageEnvelope<SessionErrorPayload> & {
  type: 'session_error';
  session_id: string;
};

export type PingPayload = Record<string, never>;
export type PingMessage = MessageEnvelope<PingPayload> & {
  type: 'ping';
  session_id: string;
};

export type PongPayload = Record<string, never>;
export type PongMessage = MessageEnvelope<PongPayload> & {
  type: 'pong';
  session_id: string;
};

export type ClientMessage =
  | SessionInitMessage
  | ContextUpdateMessage
  | SessionResumeMessage
  | SessionEndMessage
  | ActionDeniedMessage
  | ActionResultMessage
  | PingMessage;

export type ServerMessage =
  | SessionCreatedMessage
  | ActionMessage
  | SessionErrorMessage
  | SessionResumedMessage
  | PongMessage;

export type AegisMessage = ClientMessage | ServerMessage;

export function validateEnvelope(msg: unknown): msg is MessageEnvelope {
  if (typeof msg !== 'object' || msg === null) return false;
  const candidate = msg as Partial<MessageEnvelope>;
  if (typeof candidate.type !== 'string') return false;
  if (candidate.session_id !== null && typeof candidate.session_id !== 'string') return false;
  if (typeof candidate.timestamp !== 'string') return false;
  if (candidate.protocol_version !== '1.0') return false;
  if (typeof candidate.payload !== 'object' || candidate.payload === null) return false;
  return true;
}

export function validateActionObject(action: unknown): action is ActionObject {
  if (typeof action !== 'object' || action === null) return false;
  const a = action as Partial<ActionObject>;
  const allowedTypes: ActionType[] = [
    'click',
    'type',
    'scroll',
    'select',
    'hover',
    'wait',
    'done',
    'fail',
  ];
  if (!a.action_type || !allowedTypes.includes(a.action_type)) return false;

  switch (a.action_type) {
    case 'click':
    case 'hover':
      if (typeof a.target !== 'string' || !a.target) return false;
      break;
    case 'type':
      if (typeof a.target !== 'string' || !a.target) return false;
      if (typeof a.value !== 'string') return false;
      break;
    case 'scroll':
      if (a.value !== 'up' && a.value !== 'down') return false;
      break;
    case 'select':
      if (typeof a.target !== 'string' || !a.target) return false;
      if (typeof a.value !== 'string') return false;
      break;
    case 'wait':
    case 'done':
    case 'fail':
      break;
  }
  return true;
}
