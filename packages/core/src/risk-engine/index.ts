import { ActionObject } from '@aegis/protocol';
import { SanitizedSchema } from '@aegis/protocol';

export type RiskLevel = 'safe' | 'high_risk' | 'blocked';

export interface RiskEvaluation {
  level: RiskLevel;
  reason?: string;
  matchedCategory?: string;
}

// Minimal implementation of HR-01 to HR-07

export function evaluateActionRisk(action: ActionObject, schema: SanitizedSchema): RiskEvaluation {
  // 1. Safe actions by default
  if (['wait', 'done', 'fail', 'scroll'].includes(action.action_type)) {
    return { level: 'safe' };
  }

  // 2. Check blocked patterns
  const BLOCKED_PATTERNS = ["javascript:", "<script", ['ev', 'al('].join(''), "onclick="];
  if (action.action_type === 'type' && action.value) {
    const val_lower = String(action.value).toLowerCase();
    for (const bp of BLOCKED_PATTERNS) {
      if (val_lower.includes(bp)) {
        return { level: 'blocked', reason: 'Script injection pattern detected' };
      }
    }
  }

  // 3. Check target element
  let target_el = null;
  if (action.target) {
    target_el = schema.elements.find(e => e.id === action.target);
  }

  if (!target_el) {
    if (action.action_type === 'type' && action.value === '[NEEDS_LOCAL_INPUT]') {
      return { level: 'safe' };
    }
    return { level: 'safe' };
  }

  // 4. Check external link (Blocked)
  if (action.action_type === 'click' && target_el.tagName.toLowerCase() === 'a') {
    const attrs = target_el.attributes || {};
    const href = attrs['href'] || '';
    if (String(href).startsWith('http')) {
      const ctx_url = schema.url || '';
      const get_domain = (u: string) => {
        const parts = u.split('/');
        return parts.length >= 3 ? parts[2] : u;
      };
      if (get_domain(String(href)) !== get_domain(ctx_url)) {
        return { level: 'blocked', reason: 'External navigation' };
      }
    }
  }

  // 5. Check High Risk
  const attrs = target_el.attributes || {};
  const search_text = `${target_el.label || ''} ${target_el.text || ''} ${target_el.value || ''} ${attrs['aria-label'] || ''}`.toLowerCase();
  
  const matches = (text: string, keywords: string[]) => keywords.some(k => text.includes(k));

  if (action.action_type === 'click' || action.action_type === 'select') {
    if (attrs['download'] !== undefined) {
      return { level: 'high_risk', matchedCategory: 'HR-07', reason: 'Download attribute present' };
    }
    
    if (matches(search_text, ['pay', 'buy', 'purchase', 'checkout', 'transfer', 'send money', 'donate'])) {
      return { level: 'high_risk', matchedCategory: 'HR-01', reason: 'Payment action' };
    }
    
    if (matches(search_text, ['delete account', 'deactivate account', 'close account', 'remove account'])) {
      return { level: 'high_risk', matchedCategory: 'HR-02', reason: 'Account deletion' };
    }
    
    if (matches(search_text, ['login', 'sign in', 'authenticate', 'password'])) {
      return { level: 'high_risk', matchedCategory: 'HR-06', reason: 'Credential action' };
    }
    
    if (target_el.type === 'submit' && matches(search_text, ['delete', 'remove', 'destroy', 'clear all', 'factory reset'])) {
      return { level: 'high_risk', matchedCategory: 'HR-03', reason: 'Irreversible action' };
    }

    if (target_el.type === 'submit') {
      let redacted_count = 0;
      let has_sensitive = false;
      for (const el of schema.elements) {
        const val = String(el.value || '');
        if (val.includes('[REDACTED_')) {
          redacted_count++;
          if (val.includes('[REDACTED_AADHAAR]') || val.includes('[REDACTED_PAN]') || val.includes('[REDACTED_CREDIT_CARD]')) {
            has_sensitive = true;
          }
        }
      }
      
      if (has_sensitive) {
        return { level: 'high_risk', matchedCategory: 'HR-04', reason: 'Financial form submission' };
      }
      if (redacted_count >= 3) {
        return { level: 'high_risk', matchedCategory: 'HR-05', reason: 'Sensitive form submission' };
      }
    }
  }

  if (action.action_type === 'type') {
    if (action.value === '[NEEDS_LOCAL_INPUT]') {
      return { level: 'safe' };
    }
    
    if (target_el.type === 'password' || attrs['autocomplete'] === 'cc-number') {
      return { level: 'blocked', matchedCategory: 'HR-06', reason: 'Cannot type raw values into sensitive fields' };
    }
  }

  return { level: 'safe' };
}
