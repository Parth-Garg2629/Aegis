import { describe, it, expect } from 'vitest';
import {
  validateEnvelope,
  validateActionObject,
  type ContextUpdateMessage,
  type ActionMessage,
  type ActionResultMessage,
  type SessionInitMessage,
  type SessionCreatedMessage,
  type ActionDeniedMessage,
  type SessionResumeMessage,
  type SessionResumedMessage,
  type SessionEndMessage,
  type SessionErrorMessage,
  type PingMessage,
  type PongMessage,
} from '../src/index.js';

describe('Protocol Golden Message Contracts (API_SPEC §18)', () => {
  // Step 5 - Client sends context (verbatim API_SPEC §18)
  const goldenContextUpdate: ContextUpdateMessage = {
    type: 'context_update',
    session_id: 'sess-abc123',
    timestamp: '2026-09-19T10:30:20.000Z',
    protocol_version: '1.0',
    payload: {
      step_number: 5,
      agent_state: 'running',
      sanitized_screenshot: '<base64-webp>',
      screenshot_format: 'webp',
      sanitized_schema: {
        url: 'https://www.irctc.co.in/booking/passengers',
        title: 'Passenger Details - IRCTC',
        elements: [
          {
            id: 'el-10',
            tagName: 'input',
            type: 'text',
            role: null,
            label: 'Passenger Name',
            text: null,
            value: '',
            boundingBox: { x: 100, y: 180, width: 300, height: 36 },
            isVisible: true,
            isDisabled: false,
            isReadOnly: false,
            isInteractive: true,
            parentFormId: 'form-passengers',
            attributes: { name: 'passengerName', placeholder: 'Full name as on ID' },
          },
          {
            id: 'el-11',
            tagName: 'input',
            type: 'text',
            role: null,
            label: 'Aadhaar Number',
            text: null,
            value: '[REDACTED_AADHAAR]',
            boundingBox: { x: 100, y: 240, width: 300, height: 36 },
            isVisible: true,
            isDisabled: false,
            isReadOnly: false,
            isInteractive: true,
            parentFormId: 'form-passengers',
            attributes: { name: 'aadhaar', placeholder: '12-digit Aadhaar' },
          },
          {
            id: 'el-12',
            tagName: 'button',
            type: 'submit',
            role: 'button',
            label: 'Continue to Payment',
            text: 'Continue to Payment',
            value: null,
            boundingBox: { x: 200, y: 400, width: 180, height: 44 },
            isVisible: true,
            isDisabled: false,
            isReadOnly: false,
            isInteractive: true,
            parentFormId: 'form-passengers',
            attributes: { name: 'continueBtn' },
          },
        ],
        forms: [
          {
            id: 'form-passengers',
            action: '/booking/payment',
            method: 'POST',
            elementIds: ['el-10', 'el-11', 'el-12'],
          },
        ],
      },
      previous_action_result: {
        action_type: 'select',
        target_element_id: 'el-08',
        success: true,
        error_code: null,
        error_message: null,
        local_input_status: null,
      },
    },
  };

  // Step 5 - Server responds with action (verbatim API_SPEC §18)
  const goldenAction: ActionMessage = {
    type: 'action',
    session_id: 'sess-abc123',
    timestamp: '2026-09-19T10:30:23.500Z',
    protocol_version: '1.0',
    payload: {
      step_number: 5,
      action: {
        action_type: 'type',
        target: 'el-10',
        value: 'Rahul Sharma',
        reasoning:
          'The Passenger Name field is empty. I will type the name. The Aadhaar field already has a value (redacted) and does not need to be filled.',
      },
    },
  };

  // Step 5 - Client executes and reports result (verbatim API_SPEC §18)
  const goldenActionResult: ActionResultMessage = {
    type: 'action_result',
    session_id: 'sess-abc123',
    timestamp: '2026-09-19T10:30:24.100Z',
    protocol_version: '1.0',
    payload: {
      step_number: 5,
      action_type: 'type',
      success: true,
      error_code: null,
      error_message: null,
      local_input_status: null,
    },
  };

  it('validates golden context_update message structure', () => {
    expect(validateEnvelope(goldenContextUpdate)).toBe(true);
    expect(goldenContextUpdate.type).toBe('context_update');
    expect(goldenContextUpdate.payload.step_number).toBe(5);
    expect(goldenContextUpdate.payload.sanitized_schema.elements).toHaveLength(3);
    expect(goldenContextUpdate.payload.sanitized_schema.elements[1].value).toBe(
      '[REDACTED_AADHAAR]'
    );
  });

  it('validates golden action message and action object', () => {
    expect(validateEnvelope(goldenAction)).toBe(true);
    expect(goldenAction.type).toBe('action');
    expect(goldenAction.payload.action.action_type).toBe('type');
    expect(validateActionObject(goldenAction.payload.action)).toBe(true);
  });

  it('validates golden action_result message structure', () => {
    expect(validateEnvelope(goldenActionResult)).toBe(true);
    expect(goldenActionResult.type).toBe('action_result');
    expect(goldenActionResult.payload.success).toBe(true);
  });

  it('validates session_init message', () => {
    const initMsg: SessionInitMessage = {
      type: 'session_init',
      session_id: null,
      timestamp: '2026-09-19T10:30:00.000Z',
      protocol_version: '1.0',
      payload: {
        goal: 'Book a train from Mumbai to Delhi',
        client_metadata: {
          extension_version: '1.0.0',
          browser: 'chrome',
          browser_version: '128.0.0.0',
          max_steps: 30,
        },
      },
    };
    expect(validateEnvelope(initMsg)).toBe(true);
    expect(initMsg.session_id).toBeNull();
  });

  it('validates session_created message', () => {
    const createdMsg: SessionCreatedMessage = {
      type: 'session_created',
      session_id: 'sess-xyz987',
      timestamp: '2026-09-19T10:30:01.000Z',
      protocol_version: '1.0',
      payload: {
        server_max_steps: 30,
      },
    };
    expect(validateEnvelope(createdMsg)).toBe(true);
  });

  it('validates action_denied message', () => {
    const deniedMsg: ActionDeniedMessage = {
      type: 'action_denied',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:32:00.000Z',
      protocol_version: '1.0',
      payload: {
        step_number: 9,
        denied_action_type: 'click',
        risk_category: 'HR-01',
        denial_source: 'user',
      },
    };
    expect(validateEnvelope(deniedMsg)).toBe(true);
  });

  it('validates session_resume and session_resumed messages', () => {
    const resumeMsg: SessionResumeMessage = {
      type: 'session_resume',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:31:00.000Z',
      protocol_version: '1.0',
      payload: { last_known_step: 7 },
    };
    const resumedMsg: SessionResumedMessage = {
      type: 'session_resumed',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:31:01.000Z',
      protocol_version: '1.0',
      payload: { resumed: true, server_step: 7, reason: null },
    };
    expect(validateEnvelope(resumeMsg)).toBe(true);
    expect(validateEnvelope(resumedMsg)).toBe(true);
  });

  it('validates session_end and session_error messages', () => {
    const endMsg: SessionEndMessage = {
      type: 'session_end',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:35:00.000Z',
      protocol_version: '1.0',
      payload: { reason: 'goal_achieved', final_step: 12 },
    };
    const errorMsg: SessionErrorMessage = {
      type: 'session_error',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:30:02.000Z',
      protocol_version: '1.0',
      payload: {
        error_code: 'E-SRV-01',
        error_message: 'VLM inference timeout. Please retry.',
        recoverable: true,
        suggested_action: 'retry',
      },
    };
    expect(validateEnvelope(endMsg)).toBe(true);
    expect(validateEnvelope(errorMsg)).toBe(true);
  });

  it('validates ping and pong messages', () => {
    const pingMsg: PingMessage = {
      type: 'ping',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:33:00.000Z',
      protocol_version: '1.0',
      payload: {},
    };
    const pongMsg: PongMessage = {
      type: 'pong',
      session_id: 'sess-abc123',
      timestamp: '2026-09-19T10:33:00.100Z',
      protocol_version: '1.0',
      payload: {},
    };
    expect(validateEnvelope(pingMsg)).toBe(true);
    expect(validateEnvelope(pongMsg)).toBe(true);
  });

  it('enforces closed action vocabulary and constraints in validateActionObject', () => {
    // Valid actions
    expect(validateActionObject({ action_type: 'click', target: 'el-1' })).toBe(true);
    expect(validateActionObject({ action_type: 'type', target: 'el-1', value: 'hello' })).toBe(true);
    expect(validateActionObject({ action_type: 'scroll', value: 'down' })).toBe(true);
    expect(validateActionObject({ action_type: 'scroll', value: 'up' })).toBe(true);
    expect(validateActionObject({ action_type: 'select', target: 'el-1', value: 'opt1' })).toBe(true);
    expect(validateActionObject({ action_type: 'hover', target: 'el-1' })).toBe(true);
    expect(validateActionObject({ action_type: 'wait' })).toBe(true);
    expect(validateActionObject({ action_type: 'done' })).toBe(true);
    expect(validateActionObject({ action_type: 'fail' })).toBe(true);

    // Invalid actions (arbitrary commands, invalid fields, etc.)
    expect(validateActionObject({ action_type: 'eval', value: 'alert(1)' })).toBe(false);
    expect(validateActionObject({ action_type: 'click' })).toBe(false); // missing target
    expect(validateActionObject({ action_type: 'type', target: 'el-1' })).toBe(false); // missing value
    expect(validateActionObject({ action_type: 'scroll', value: 'left' })).toBe(false); // only up/down allowed
  });
});
