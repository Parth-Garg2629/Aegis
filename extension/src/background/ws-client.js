/**
 * AEGIS WebSocket Client (Work Package B1)
 * Source of Truth: docs/API_SPEC.md §3, docs/TECHNICAL_SPEC.md §11, docs/IMPLEMENTATION_PLAN.md B1
 *
 * Implements typed WebSocket client for extension background service worker.
 * Enforces the Sanitized<T> compile-time privacy boundary (ADR-04): sendContextUpdate
 * strictly accepts only Sanitized<ContextUpdatePayload>.
 */
import { slog } from '@aegis/shared';
export class AegisWebSocketClient {
    ws = null;
    sessionId = null;
    serverUrl;
    callbacks = {};
    isConnecting = false;
    constructor(serverUrl = 'ws://127.0.0.1:8765/ws') {
        this.serverUrl = serverUrl;
    }
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }
    getSessionId() {
        return this.sessionId;
    }
    setSessionId(id) {
        this.sessionId = id;
    }
    isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    async connect() {
        if (this.isConnected())
            return;
        if (this.isConnecting)
            return;
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
            }
            catch (err) {
                this.isConnecting = false;
                reject(err);
            }
        });
    }
    handleIncomingMessage(data) {
        try {
            if (typeof data !== 'string')
                return;
            const parsed = JSON.parse(data);
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
                    // Heartbeat received
                    break;
                default:
                    slog.warn({
                        module: 'WS_CLIENT',
                        event: 'UNKNOWN_SERVER_MESSAGE',
                    });
                    break;
            }
        }
        catch (err) {
            slog.error({
                module: 'WS_CLIENT',
                event: 'MESSAGE_PARSE_ERROR',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    sendSessionInit(goal, clientMetadata) {
        const msg = {
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
    /**
     * Statically enforces the privacy boundary: only Sanitized<ContextUpdatePayload>
     * may be transmitted over the network (ADR-04).
     */
    sendContextUpdate(payload) {
        if (!this.sessionId) {
            throw new Error('Cannot send context_update without an active session ID');
        }
        const msg = {
            type: 'context_update',
            session_id: this.sessionId,
            timestamp: new Date().toISOString(),
            protocol_version: '1.0',
            payload,
        };
        this.send(msg);
    }
    sendActionResult(result) {
        if (!this.sessionId)
            return;
        const msg = {
            type: 'action_result',
            session_id: this.sessionId,
            timestamp: new Date().toISOString(),
            protocol_version: '1.0',
            payload: result,
        };
        this.send(msg);
    }
    sendSessionEnd(reason, finalStep) {
        if (!this.sessionId)
            return;
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
    ping() {
        if (!this.sessionId)
            return;
        const msg = {
            type: 'ping',
            session_id: this.sessionId,
            timestamp: new Date().toISOString(),
            protocol_version: '1.0',
            payload: {},
        };
        this.send(msg);
    }
    send(msg) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        this.ws.send(JSON.stringify(msg));
    }
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'Normal Closure');
            this.ws = null;
        }
        this.sessionId = null;
    }
}
//# sourceMappingURL=ws-client.js.map