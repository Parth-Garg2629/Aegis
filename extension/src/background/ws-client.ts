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
import { slog, type Sanitized } from '@aegis/shared';

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

  constructor(serverUrl = 'ws://127.0.0.1:8765/ws') {
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
            event: 'WS_CONNECTED',
            url: this.serverUrl,
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
            event: 'WS_ERROR',
            message: 'WebSocket connection error',
          });
          reject(err);
        };

        socket.onclose = (event) => {
          this.ws = null;
          this.isConnecting = false;
          slog.info({
            module: 'WS_CLIENT',
            event: 'WS_DISCONNECTED',
            code: event.code,
            reason: event.reason,
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

    const msg: ContextUpdateMessage = {
      type: 'context_update',
      session_id: this.sessionId,
      timestamp: new Date().toISOString(),
      protocol_version: '1.0',
      payload,
    };
    this.send(msg);
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

  private send(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Normal Closure');
      this.ws = null;
    }
    this.sessionId = null;
  }
}
