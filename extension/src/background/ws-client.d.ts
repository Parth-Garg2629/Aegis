/**
 * AEGIS WebSocket Client (Work Package B1)
 * Source of Truth: docs/API_SPEC.md §3, docs/TECHNICAL_SPEC.md §11, docs/IMPLEMENTATION_PLAN.md B1
 *
 * Implements typed WebSocket client for extension background service worker.
 * Enforces the Sanitized<T> compile-time privacy boundary (ADR-04): sendContextUpdate
 * strictly accepts only Sanitized<ContextUpdatePayload>.
 */
import type { ActionMessage, ActionResultPayload, ClientMetadata, ContextUpdatePayload, SessionCreatedMessage, SessionEndPayload, SessionErrorMessage } from '@aegis/protocol';
import { type Sanitized } from '@aegis/shared';
export interface WebSocketClientCallbacks {
    onSessionCreated?: (msg: SessionCreatedMessage) => void;
    onAction?: (msg: ActionMessage) => void;
    onSessionError?: (msg: SessionErrorMessage) => void;
    onClose?: (code: number, reason: string) => void;
}
export declare class AegisWebSocketClient {
    private ws;
    private sessionId;
    private serverUrl;
    private callbacks;
    private isConnecting;
    constructor(serverUrl?: string);
    setCallbacks(callbacks: WebSocketClientCallbacks): void;
    getSessionId(): string | null;
    setSessionId(id: string | null): void;
    isConnected(): boolean;
    connect(): Promise<void>;
    private handleIncomingMessage;
    sendSessionInit(goal: string, clientMetadata: ClientMetadata): void;
    /**
     * Statically enforces the privacy boundary: only Sanitized<ContextUpdatePayload>
     * may be transmitted over the network (ADR-04).
     */
    sendContextUpdate(payload: Sanitized<ContextUpdatePayload>): void;
    sendActionResult(result: ActionResultPayload): void;
    sendSessionEnd(reason: SessionEndPayload['reason'], finalStep: number): void;
    ping(): void;
    private send;
    disconnect(): void;
}
//# sourceMappingURL=ws-client.d.ts.map