import { ActionObject, ActionType } from '@aegis/protocol';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ALLOWED_ACTIONS: ActionType[] = [
  'click', 'type', 'scroll', 'select', 'hover', 'navigate', 'wait', 'done', 'fail'
];

export function validateAction(action: ActionObject): ValidationResult {
  if (!action || typeof action !== 'object') {
    return { valid: false, error: 'Action is not an object' };
  }

  if (!ALLOWED_ACTIONS.includes(action.action_type)) {
    return { valid: false, error: `Invalid action_type: ${action.action_type}` };
  }

  switch (action.action_type) {
    case 'click':
    case 'hover':
      if (typeof action.target !== 'string' || !action.target) {
        return { valid: false, error: `${action.action_type} requires a target` };
      }
      break;
    case 'type':
      if (typeof action.target !== 'string' || !action.target) {
        return { valid: false, error: `type requires a target` };
      }
      if (typeof action.value !== 'string') {
        return { valid: false, error: `type requires a string value` };
      }
      break;
    case 'scroll':
      if (action.value !== 'up' && action.value !== 'down') {
        return { valid: false, error: `scroll requires value "up" or "down"` };
      }
      break;
    case 'select':
      if (typeof action.target !== 'string' || !action.target) {
        return { valid: false, error: `select requires a target` };
      }
      if (typeof action.value !== 'string') {
        return { valid: false, error: `select requires a string value` };
      }
      break;
    case 'navigate':
      if (typeof action.value !== 'string') {
        return { valid: false, error: 'navigate requires a URL value' };
      }
      try {
        const url = new URL(action.value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return { valid: false, error: 'navigate only supports HTTP or HTTPS URLs' };
        }
      } catch {
        return { valid: false, error: 'navigate requires a valid URL' };
      }
      break;
    case 'wait':
    case 'done':
    case 'fail':
      break; // No specific requirements
  }

  return { valid: true };
}
