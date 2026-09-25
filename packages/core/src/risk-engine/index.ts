import { ActionObject } from '@aegis/protocol';
import { SanitizedSchema } from '@aegis/protocol';

export type RiskLevel = 'safe' | 'high_risk' | 'blocked';

export interface RiskEvaluation {
  level: RiskLevel;
  reason?: string;
  matchedCategory?: string;
}

// Minimal implementation of HR-01 to HR-07
const HIGH_RISK_KEYWORDS = [
  'pay', 'buy', 'purchase', 'checkout',
  'delete', 'remove', 'destroy',
  'transfer', 'send money',
  'submit application',
  'login', 'sign in'
];

export function evaluateActionRisk(action: ActionObject, schema: SanitizedSchema): RiskEvaluation {
  // Wait, fail, done are always safe
  if (['wait', 'done', 'fail'].includes(action.action_type)) {
    return { level: 'safe' };
  }

  // Type actions where value is [NEEDS_LOCAL_INPUT] are safe because they just trigger local input
  // Type actions into sensitive fields should already be blocked by the agent prompt, but we double check
  if (action.action_type === 'type') {
    if (action.value === '[NEEDS_LOCAL_INPUT]') return { level: 'safe' };
    
    // For MVP, if it targets a known sensitive element, block typing anything other than local input
    if (action.target) {
      const el = schema.elements.find(e => e.id === action.target);
      // We don't have the raw element, but if the label suggests password etc.
      // (This is a simplified check for MVP)
      if (el && (el.type === 'password' || el.attributes?.autocomplete === 'cc-number')) {
        return { level: 'blocked', reason: 'Cannot type raw values into sensitive fields', matchedCategory: 'HR-02' };
      }
    }
  }

  // Check clicks and selects for high-risk keywords in the target element
  if (action.action_type === 'click' || action.action_type === 'select') {
    if (action.target) {
      const el = schema.elements.find(e => e.id === action.target);
      if (el) {
        const textToSearch = `${el.label || ''} ${el.text || ''} ${el.value || ''}`.toLowerCase();
        for (const keyword of HIGH_RISK_KEYWORDS) {
          if (textToSearch.includes(keyword)) {
            // MVP Fail-closed: We reject high-risk actions instead of showing confirmation UI
            return { level: 'blocked', reason: `High-risk keyword '${keyword}' detected in target`, matchedCategory: 'HR-01' };
          }
        }
      }
    }
  }

  return { level: 'safe' };
}
