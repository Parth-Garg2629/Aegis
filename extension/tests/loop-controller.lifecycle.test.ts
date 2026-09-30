import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionMessage, SanitizedSchema } from '@aegis/protocol';
import type { SessionStateUpdateMessage } from '../src/background/bus';
import { scanGoal } from '@aegis/core';

vi.mock('../src/background/capture', () => ({
  captureActiveTab: vi.fn(async () => ({
    screenshotDataUrl: 'data:image/jpeg;base64,dGVzdA==',
    format: 'jpeg',
    dpr: 1,
    width: 800,
    height: 600,
  })),
}));

vi.mock('../src/background/offscreen-manager', () => ({ ensureOffscreenDocument: vi.fn(async () => {}) }));

vi.mock('@aegis/core', () => ({
  scanGoal: vi.fn((goal: string) => ({ hasSensitiveContent: false, categories: [], sanitizedGoal: goal })),
  validateAction: vi.fn(() => ({ valid: true })),
  evaluateActionRisk: vi.fn(() => ({ level: 'safe' })),
}));

import { LoopController } from '../src/background/loop-controller';

const schema: SanitizedSchema = {
  url: 'http://127.0.0.1:8766/fp_01.html',
  title: 'Lifecycle Fixture',
  elements: [
    {
      id: 'el-input',
      tagName: 'input',
      type: 'text',
      label: 'Search',
      value: null,
      boundingBox: { x: 1, y: 1, width: 100, height: 24 },
      isVisible: true,
      isDisabled: false,
      isReadOnly: false,
      isInteractive: true,
      attributes: {},
    },
    {
      id: 'el-search',
      tagName: 'button',
      type: 'button',
      label: 'Search',
      text: 'Search',
      value: null,
      boundingBox: { x: 1, y: 30, width: 80, height: 24 },
      isVisible: true,
      isDisabled: false,
      isReadOnly: false,
      isInteractive: true,
      attributes: {},
    },
  ],
};

let contentScriptMissing = false;
let domExtractionFailed = false;
let executionFailureCode: string | null = null;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static nextSession = 0;
  static instances: FakeWebSocket[] = [];
  static failNextSession = false;
  static disconnectNextContext = false;
  static sendStaleActionNext = false;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sessionId = '';
  messages: Array<Record<string, any>> = [];

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as Record<string, any>;
    this.messages.push(message);

    if (message.type === 'session_init') {
      this.sessionId = `session-${++FakeWebSocket.nextSession}`;
      queueMicrotask(() => this.deliver({
        type: 'session_created',
        session_id: this.sessionId,
        timestamp: new Date().toISOString(),
        protocol_version: '1.0',
        payload: { server_max_steps: 30, provider_name: 'test-provider', model_name: 'test', is_mock: true },
      }));
      return;
    }

    if (message.type === 'context_update') {
      if (FakeWebSocket.disconnectNextContext) {
        FakeWebSocket.disconnectNextContext = false;
        this.close();
        return;
      }
      const step = message.payload.step_number as number;
      const action: ActionMessage['payload']['action'] = FakeWebSocket.failNextSession
        ? { action_type: 'fail', reasoning: 'controlled test failure' }
        : step === 1
          ? { action_type: 'type', target: 'el-input', value: 'Scholarship Portal' }
          : step === 2
            ? { action_type: 'click', target: 'el-search' }
            : { action_type: 'done' };
      if (FakeWebSocket.failNextSession) FakeWebSocket.failNextSession = false;
      const response: ActionMessage = {
        type: 'action',
        session_id: this.sessionId,
        timestamp: new Date().toISOString(),
        protocol_version: '1.0',
        payload: { step_number: step, action, risk_assessment: { level: 'safe', category: null, reason: null } },
      };
      if (FakeWebSocket.sendStaleActionNext) {
        FakeWebSocket.sendStaleActionNext = false;
        queueMicrotask(() => this.deliver({ ...response, session_id: 'stale-session', payload: { ...response.payload, step_number: step + 1 } }));
      }
      queueMicrotask(() => this.deliver(response));
    }
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: 'closed' }));
  }

  private deliver(message: Record<string, any>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function makeChromeApi() {
  return {
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn(async (_tabId: number, message: Record<string, any>) => {
        if (message.type === 'EXTRACT_DOM_REQUEST') {
          if (domExtractionFailed) {
            return { type: 'EXTRACT_DOM_RESPONSE', success: false, errorCode: 'DOM_EXTRACTION_FAILED', schema: { url: '', title: '', elements: [] }, elementsCount: 0, domSignals: [], piiSignals: [] };
          }
          if (contentScriptMissing) {
            contentScriptMissing = false;
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return { type: 'EXTRACT_DOM_RESPONSE', success: true, schema, elementsCount: schema.elements.length, domSignals: [], piiSignals: [] };
        }
        if (message.type === 'EXECUTE_ACTION_REQUEST') {
          return {
            type: 'EXECUTE_ACTION_RESPONSE',
            result: {
              step_number: message.stepNumber,
              action_type: message.action.action_type,
              success: executionFailureCode === null,
              error_code: executionFailureCode ?? undefined,
              error_message: executionFailureCode ? 'Target unavailable' : undefined,
            },
          };
        }
        throw new Error('Unexpected tab message');
      }),
    },
    runtime: {
      sendMessage: vi.fn(async (message: Record<string, any>) => {
        if (message.type === 'RUN_PERCEPTION_CYCLE') {
          return { sensitivityMap: { regions: [] }, _nonce: message._nonce };
        }
        if (message.type === 'BUILD_SANITIZED_CONTEXT') {
          return {
            success: true,
            payload: {
              step_number: message.input.stepNumber,
              agent_state: 'running',
              sanitized_screenshot: 'data:image/webp;base64,dGVzdA==',
              screenshot_format: 'webp',
              sanitized_schema: message.input.rawSchema,
              previous_action_result: message.input.previousActionResult,
            },
            _nonce: message._nonce,
          };
        }
        throw new Error('Unexpected runtime message');
      }),
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
  };
}

let mockChromeApi: ReturnType<typeof makeChromeApi>;

describe('LoopController lifecycle', () => {
  beforeEach(() => {
    FakeWebSocket.nextSession = 0;
    FakeWebSocket.instances = [];
    FakeWebSocket.failNextSession = false;
    FakeWebSocket.disconnectNextContext = false;
    FakeWebSocket.sendStaleActionNext = false;
    contentScriptMissing = false;
    domExtractionFailed = false;
    executionFailureCode = null;
    vi.stubGlobal('WebSocket', FakeWebSocket);
    mockChromeApi = makeChromeApi();
    vi.stubGlobal('chrome', mockChromeApi);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears completed cycle timers and supports three consecutive multi-cycle sessions', async () => {
    vi.useFakeTimers();
    const controller = new LoopController();
    const ids: string[] = [];
    FakeWebSocket.sendStaleActionNext = true;

    for (const goal of ['first goal', 'second goal', 'third goal']) {
      await controller.start(goal);
      expect(controller.getState()).toBe('completed');
      expect(controller.getCurrentStep()).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
      const socket = FakeWebSocket.instances.at(-1)!;
      ids.push(socket.sessionId);
      expect(socket.messages.filter((message) => message.type === 'context_update').map((message) => message.payload.step_number)).toEqual([1, 2, 3]);
      expect(socket.messages.filter((message) => message.type === 'action_result').map((message) => message.payload.step_number)).toEqual([1, 2, 3]);
      expect(socket.messages.at(-1)?.type).toBe('session_end');
    }

    expect(new Set(ids).size).toBe(3);
  });

  it('cleans up after failure so the same controller can start another session', async () => {
    vi.useFakeTimers();
    const updates: SessionStateUpdateMessage[] = [];
    const controller = new LoopController({ onStateChange: (update) => updates.push(update) });
    FakeWebSocket.failNextSession = true;

    await controller.start('fail once');
    await Promise.resolve();
    expect(controller.getState()).toBe('failed');
    expect(updates.filter((update) => update.state === 'failed')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    await controller.start('start after failure');
    expect(controller.getState()).toBe('completed');
    expect(FakeWebSocket.instances[1].sessionId).not.toBe(FakeWebSocket.instances[0].sessionId);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('injects the content script once when an existing tab has no listener yet', async () => {
    vi.useFakeTimers();
    contentScriptMissing = true;
    const controller = new LoopController();

    await controller.start('run after extension load');

    expect(controller.getState()).toBe('completed');
    expect(mockChromeApi.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(mockChromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content.js'],
    });
  });

  it('fails closed instead of treating an extraction error as an empty page', async () => {
    const updates: SessionStateUpdateMessage[] = [];
    const controller = new LoopController({ onStateChange: (update) => updates.push(update) });
    domExtractionFailed = true;

    await controller.start('do not act without extracted page state');

    expect(controller.getState()).toBe('failed');
    expect(updates.at(-1)?.error).toContain('E-DOM_EXTRACTION_FAILED');
    expect(FakeWebSocket.instances[0].messages.some((message) => message.type === 'context_update')).toBe(false);
  });

  it('preserves the concrete browser execution error in the final session state', async () => {
    const updates: SessionStateUpdateMessage[] = [];
    const controller = new LoopController({ onStateChange: (update) => updates.push(update) });
    executionFailureCode = 'E-EXEC-01';

    await controller.start('stop when the browser target cannot be found');

    expect(controller.getState()).toBe('failed');
    expect(updates.at(-1)?.error).toContain('E-EXEC-01');
    expect(FakeWebSocket.instances[0].messages.some((message) => message.type === 'context_update' && message.payload.step_number === 2)).toBe(false);
  });

  it('sends a PII-scrubbed goal to the backend', async () => {
    const controller = new LoopController();
    vi.mocked(scanGoal).mockReturnValueOnce({ hasSensitiveContent: true, categories: ['EMAIL'], sanitizedGoal: 'Search for [REDACTED_EMAIL]' });
    await controller.start('Search for user@example.com');
    const init = FakeWebSocket.instances[0].messages.find((message) => message.type === 'session_init');
    expect(init?.payload.goal).toContain('[REDACTED_EMAIL]');
    expect(init?.payload.goal).not.toContain('user@example.com');
  });

  it('settles a pending action wait on disconnect and permits a fresh session', async () => {
    vi.useFakeTimers();
    const controller = new LoopController();
    FakeWebSocket.disconnectNextContext = true;
    await controller.start('disconnect during action');

    expect(controller.getState()).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
    await controller.start('fresh after disconnect');
    expect(controller.getState()).toBe('completed');
    expect(FakeWebSocket.instances[1].sessionId).not.toBe(FakeWebSocket.instances[0].sessionId);
  });
});
