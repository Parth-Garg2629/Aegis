import type {
  ActionMessage,
  ActionResultPayload,
  ClientMetadata,
  ContextUpdateMessage,
  ContextUpdatePayload,
  PingMessage,
  ServerMessage,
  SessionCreatedMessage,
  SessionEndPayload,
  SessionErrorMessage,
  SessionInitMessage,
} from '@aegis/protocol';
import { DEFAULT_SERVER_ENDPOINT, slog, type Sanitized } from '@aegis/shared';
import { MINIMAL_WEBP_BASE64 } from './capture';

const MAX_CONTEXT_MESSAGE_BYTES = 2 * 1024 * 1024 - 32 * 1024;

export interface WebSocketClientCallbacks {
  onSessionCreated?: (msg: SessionCreatedMessage) => void;
  onAction?: (msg: ActionMessage) => void;
  onSessionError?: (msg: SessionErrorMessage) => void;
  onClose?: (code: number, reason: string) => void;
}

export class AegisWebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private serverUrl: string;
  private callbacks: WebSocketClientCallbacks = {};
  private isConnecting = false;

  constructor(serverUrl = DEFAULT_SERVER_ENDPOINT) {
    this.serverUrl = serverUrl;
  }

  public setCallbacks(callbacks: WebSocketClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public setSessionId(id: string | null): void {
    this.sessionId = id;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (this.isConnecting) return;

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        const socket = new WebSocket(this.serverUrl);

        socket.onopen = () => {
          this.ws = socket;
          this.isConnecting = false;
          slog.info({
            module: 'WS_CLIENT',
            event: 'WEBSOCKET_OPEN',
            status: 'open',
          });
          resolve();
        };

        socket.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };

        socket.onerror = (err) => {
          this.isConnecting = false;
          slog.error({
            module: 'WS_CLIENT',
            event: 'WEBSOCKET_ERROR',
            error_code: 'WS_CONNECT_ERROR',
            status: 'error',
          });
          reject(err);
        };

        socket.onclose = (event) => {
          this.ws = null;
          this.isConnecting = false;
          slog.info({
            module: 'WS_CLIENT',
            event: 'WEBSOCKET_CLOSE',
            error_code: event.code ? `WS_CLOSE_${event.code}` : 'WS_CLOSE_UNKNOWN',
            status: 'closed',
            session_id: this.sessionId || undefined,
          });
          this.callbacks.onClose?.(event.code, event.reason);
        };
      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  private handleIncomingMessage(data: unknown): void {
    try {
      if (typeof data !== 'string') return;
      const parsed = JSON.parse(data) as ServerMessage;

      switch (parsed.type) {
        case 'session_created':
          this.sessionId = parsed.session_id;
          slog.info({
            module: 'WS_CLIENT',
            event: 'SESSION_CREATED',
            session_id: this.sessionId,
          });
          this.callbacks.onSessionCreated?.(parsed);
          break;

        case 'action':
          this.callbacks.onAction?.(parsed);
          break;

        case 'session_error':
          slog.error({
            module: 'WS_CLIENT',
            event: 'SESSION_ERROR',
            error_code: parsed.payload.error_code,
            message: parsed.payload.error_message,
          });
          this.callbacks.onSessionError?.(parsed);
          break;

        case 'pong':
          break;

        default:
          slog.warn({
            module: 'WS_CLIENT',
            event: 'UNKNOWN_SERVER_MESSAGE',
          });
          break;
      }
    } catch (err: unknown) {
      slog.error({
        module: 'WS_CLIENT',
        event: 'MESSAGE_PARSE_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public sendSessionInit(goal: string, clientMetadata: ClientMetadata): void {
    const msg: SessionInitMessage = {
      type: 'session_init',
      session_id: null,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: {
        goal,
        client_metadata: clientMetadata,
      },
    };
    this.send(msg);
  }

  public sendContextUpdate(payload: Sanitized<ContextUpdatePayload>): void {
    if (!this.sessionId) {
      throw new Error('Cannot send context_update without an active session ID');
    }

    let msg: ContextUpdateMessage = {
      type: 'context_update',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload,
    };
    let serialized = JSON.stringify(msg);
    let messageBytes = new TextEncoder().encode(serialized).byteLength;
    if (messageBytes > MAX_CONTEXT_MESSAGE_BYTES) {
      // The DOM is already sanitized and is sufficient for element targeting.
      // Drop only the sanitized screenshot when a large page would exceed the
      // gateway's message limit; this prevents the server from closing WS.
      msg = {
        ...msg,
        payload: {
          ...payload,
          sanitized_screenshot: MINIMAL_WEBP_BASE64,
          screenshot_format: 'webp',
        },
      };
      serialized = JSON.stringify(msg);
      messageBytes = new TextEncoder().encode(serialized).byteLength;

      if (messageBytes > MAX_CONTEXT_MESSAGE_BYTES) {
        const elements = payload.sanitized_schema.elements;
        const elementPriority = (element: (typeof elements)[number]): number => {
          const attrs = element.attributes || {};
          const hints = [element.label, element.text, attrs['aria-label'], attrs.placeholder, attrs.type]
            .filter(Boolean).join(' ').toLowerCase();
          if (/\b(search|find)\b/.test(hints)) return 3;
          if (/\b(log\s*out|logout|sign\s*out|signout|log\s*in|login|sign\s*in|account|profile)\b/.test(hints)) return 2;
          if (['input', 'button', 'textarea', 'select'].includes(element.tagName.toLowerCase())) return 1;
          return 0;
        };
        const rankedIndexes = elements
          .map((element, index) => ({ index, priority: elementPriority(element) }))
          .sort((a, b) => b.priority - a.priority || a.index - b.index);

        let keepCount = elements.length;
        while (messageBytes > MAX_CONTEXT_MESSAGE_BYTES && keepCount > 0) {
          keepCount = Math.floor(keepCount * 0.75);
          const retained = new Set(rankedIndexes.slice(0, keepCount).map(({ index }) => index));
          const boundedElements = elements
            .filter((_element, index) => retained.has(index))
            .map((element) => ({
              ...element,
              label: element.label?.slice(0, 160),
              text: element.text?.slice(0, 160),
              value: element.value?.slice(0, 160),
              attributes: Object.fromEntries(
                Object.entries(element.attributes || {}).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value.slice(0, 160) : value,
                ]),
              ),
            }));
          const retainedIds = new Set(boundedElements.map((element) => element.id));
          msg = {
            ...msg,
            payload: {
              ...msg.payload,
              sanitized_schema: {
                ...payload.sanitized_schema,
                title: payload.sanitized_schema.title.slice(0, 200),
                elements: boundedElements,
                forms: (payload.sanitized_schema.forms || [])
                  .slice(0, 100)
                  .map((form) => ({ ...form, elementIds: form.elementIds.filter((id) => retainedIds.has(id)) }))
                  .filter((form) => form.elementIds.length > 0),
              },
            },
          };
          serialized = JSON.stringify(msg);
          messageBytes = new TextEncoder().encode(serialized).byteLength;
        }
      }
      slog.warn({
        module: 'WS_CLIENT',
        event: 'CONTEXT_SCREENSHOT_DROPPED_FOR_SIZE',
        session_id: this.sessionId,
        step_number: payload.step_number,
        message_bytes: messageBytes,
        status: 'degraded',
      });
    }
    this.send(msg, serialized);
  }

  public sendActionResult(result: ActionResultPayload): void {
    if (!this.sessionId) return;
    const msg = {
      type: 'action_result',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: result,
    };
    this.send(msg);
  }

  public sendSessionEnd(reason: SessionEndPayload['reason'], finalStep: number): void {
    if (!this.sessionId) return;
    const msg = {
      type: 'session_end',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: {
        reason,
        final_step: finalStep,
      },
    };
    this.send(msg);
    this.sessionId = null;
  }

  public sendActionDenied(step_number: number, denied_action_type: string, risk_category: string, denial_source: 'user' | 'user_denied' | 'risk_engine_blocked'): void {
    if (!this.sessionId) return;
    const msg = {
      type: 'action_denied',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: {
        step_number,
        denied_action_type,
        risk_category,
        denial_source,
      },
    };
    this.send(msg);
  }

  public ping(): void {
    if (!this.sessionId) return;
    const msg: PingMessage = {
      type: 'ping',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload: {},
    };
    this.send(msg);
  }

  private send(msg: unknown, serialized?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(serialized ?? JSON.stringify(msg));
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Normal Closure');
      this.ws = null;
    }
    this.sessionId = null;
  }
}
