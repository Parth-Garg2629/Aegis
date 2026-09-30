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

        // Submit only inputs that identify themselves as search controls. Do
        // not submit arbitrary forms (for example, login forms) after typing.
        const searchHints = [
          el.getAttribute('type'),
          el.getAttribute('role'),
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('name'),
          el.form?.getAttribute('role'),
          el.form?.getAttribute('aria-label'),
          el.form?.getAttribute('action'),
        ].filter(Boolean).join(' ').toLowerCase();
        const isSearch =
          (el instanceof HTMLInputElement && el.type === 'search') ||
          (el instanceof HTMLInputElement && el.name.toLowerCase() === 'q') ||
          /\b(search|find)\b/.test(searchHints);
        if (isSearch) {
          const enterOpts: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
          el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
          el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
          // Also try submitting the closest form directly as a fallback
          el.form?.requestSubmit?.();
        }

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
      return true;
    }
    return false;
  });
}
