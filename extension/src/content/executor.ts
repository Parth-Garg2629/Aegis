/**
 * AEGIS Action Executor (Work Package B6)
 * Source of Truth: docs/BROWSER_AGENT_SPEC.md §5, docs/IMPLEMENTATION_PLAN.md B6
 * Executes closed-vocabulary actions (click, type, scroll, select, hover, wait, done, fail)
 * using native property setters and standard DOM event dispatching.
 */

import type { ActionObject, ActionResultPayload } from '@aegis/protocol';
import { slog } from '@aegis/shared';
import { idRegistry } from './id-registry';
import type { ExecuteActionRequestMessage, ExecuteActionResponseMessage } from '../background/bus';

export async function executeAction(action: ActionObject, stepNumber: number): Promise<ActionResultPayload> {
  const { action_type, target, value } = action;

  slog.info({
    module: 'CONTENT_SCRIPT',
    event: 'ACTION_EXECUTION_START',
    action_type,
    step_number: stepNumber,
  });

  try {
    switch (action_type) {
      case 'click': {
        if (!target) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: 'Click action requires a valid target element ID',
          };
        }

        const el = idRegistry.getElementById(target);
        if (!el || !(el instanceof HTMLElement)) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: `Target element "${target}" not found in page registry`,
          };
        }

        el.scrollIntoView({ behavior: 'instant', block: 'center' });

        const pointerOpts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        el.dispatchEvent(new MouseEvent('mousedown', pointerOpts));
        el.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
        el.dispatchEvent(new MouseEvent('mouseup', pointerOpts));
        el.click();

        return { step_number: stepNumber, action_type, success: true };
      }

      case 'type': {
        if (!target) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: 'Type action requires a valid target element ID',
          };
        }

        const el = idRegistry.getElementById(target);
        if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: `Target element "${target}" is not an editable text input`,
          };
        }

        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.focus();

        const textToType = value ?? '';
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

        if (nativeSetter) {
          nativeSetter.call(el, textToType);
        } else {
          el.value = textToType;
        }

        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

        return { step_number: stepNumber, action_type, success: true };
      }

      case 'scroll': {
        if (target) {
          const el = idRegistry.getElementById(target);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { step_number: stepNumber, action_type, success: true };
          }
        }
        window.scrollBy({ top: 300, behavior: 'instant' });
        return { step_number: stepNumber, action_type, success: true };
      }

      case 'select': {
        if (!target) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: 'Select action requires a valid target element ID',
          };
        }

        const el = idRegistry.getElementById(target);
        if (!el || !(el instanceof HTMLSelectElement)) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-02',
            error_message: `Target element "${target}" is not a select dropdown`,
          };
        }

        if (value !== undefined && value !== null) {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }

        return { step_number: stepNumber, action_type, success: true };
      }

      case 'hover': {
        if (!target) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: 'Hover action requires a valid target element ID',
          };
        }

        const el = idRegistry.getElementById(target);
        if (!el) {
          return {
            step_number: stepNumber,
            action_type,
            success: false,
            error_code: 'E-EXEC-01',
            error_message: `Target element "${target}" not found`,
          };
        }

        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
        return { step_number: stepNumber, action_type, success: true };
      }

      case 'wait': {
        const ms = value ? parseInt(value, 10) : 500;
        await new Promise((resolve) => setTimeout(resolve, isNaN(ms) ? 500 : ms));
        return { step_number: stepNumber, action_type, success: true };
      }

      case 'done': {
        return { step_number: stepNumber, action_type, success: true };
      }

      case 'fail': {
        return {
          step_number: stepNumber,
          action_type,
          success: false,
          error_code: 'E-EXEC-02',
          error_message: action.reasoning || 'Action failed as reported by agent',
        };
      }

      default: {
        return {
          step_number: stepNumber,
          action_type: String(action_type),
          success: false,
          error_code: 'E-EXEC-02',
          error_message: `Unsupported action type: "${action_type}"`,
        };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      step_number: stepNumber,
      action_type,
      success: false,
      error_code: 'E-EXEC-02',
      error_message: message,
    };
  }
}

// Internal listener for Service Worker execution requests
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message: ExecuteActionRequestMessage, _sender, sendResponse) => {
    if (message.type === 'EXECUTE_ACTION_REQUEST') {
      executeAction(message.action, message.stepNumber).then((result) => {
        const response: ExecuteActionResponseMessage = {
          type: 'EXECUTE_ACTION_RESPONSE',
          result,
        };
        sendResponse(response);
      });
      return true; // Keep channel open for async response
    }
    return false;
  });
}
