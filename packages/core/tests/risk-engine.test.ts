import { describe, it, expect } from 'vitest';
import { evaluateActionRisk } from '../src/risk-engine/index';
import { ActionObject, SanitizedSchema } from '@aegis/protocol';

describe('Risk Engine Parity Tests (TS)', () => {
  const baseSchema: SanitizedSchema = {
    url: 'http://test.local',
    title: 'Test',
    elements: [
      { id: 'el-1', tagName: 'button', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'button', text: 'Click me' },
      { id: 'el-2', tagName: 'a', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'link', attributes: { href: 'http://external.com' } },
      { id: 'el-3', tagName: 'input', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'textbox', attributes: { type: 'text' } },
      { id: 'el-4', tagName: 'button', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'button', text: 'Pay Now' },
      { id: 'el-5', tagName: 'button', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'button', text: 'Delete Account' },
      { id: 'el-6', tagName: 'button', type: 'submit', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'button', text: 'Clear All' },
      { id: 'el-7', tagName: 'button', type: 'submit', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'button', text: 'Submit' },
      { id: 'el-8', tagName: 'input', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'textbox', value: '[REDACTED_AADHAAR]' },
      { id: 'el-9', tagName: 'a', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'link', attributes: { download: 'true' } },
      { id: 'el-10', tagName: 'input', type: 'password', isVisible: true, isInteractive: true, isDisabled: false, isReadOnly: false, boundingBox: { x: 0, y: 0, width: 100, height: 30 }, role: 'textbox' }
    ]
  };

  it('safe actions', () => {
    const action: ActionObject = { action_type: 'scroll', value: 'down' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('safe');
  });

  it('blocked external link', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-2' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('blocked');
    expect(res.reason).toContain('External navigation');
  });

  it('blocked script injection', () => {
    const action: ActionObject = { action_type: 'type', target: 'el-3', value: 'javascript:alert(1)' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('blocked');
  });

  it('HR-01 payment keyword', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-4' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('high_risk');
    expect(res.matchedCategory).toBe('HR-01');
  });

  it('HR-02 account deletion', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-5' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('high_risk');
    expect(res.matchedCategory).toBe('HR-02');
  });

  it('HR-03 irreversible data action', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-6' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('high_risk');
    expect(res.matchedCategory).toBe('HR-03');
  });

  it('HR-04 financial form', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-7' }; // Submit button
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('high_risk');
    expect(res.matchedCategory).toBe('HR-04');
  });

  it('HR-07 download initiation', () => {
    const action: ActionObject = { action_type: 'click', target: 'el-9' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('high_risk');
    expect(res.matchedCategory).toBe('HR-07');
  });

  it('type into sensitive field is blocked', () => {
    const action: ActionObject = { action_type: 'type', target: 'el-10', value: 'secret' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('blocked');
    expect(res.matchedCategory).toBe('HR-06');
  });
  
  it('type local input placeholder is safe', () => {
    const action: ActionObject = { action_type: 'type', target: 'el-3', value: '[NEEDS_LOCAL_INPUT]' };
    const res = evaluateActionRisk(action, baseSchema);
    expect(res.level).toBe('safe');
  });
});
