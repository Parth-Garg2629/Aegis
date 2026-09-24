import type { NormalizedSignal } from '../types';

export function analyzeDomElement(element: any): NormalizedSignal[] {
  const signals: NormalizedSignal[] = [];
  
  if (!element) return signals;

  const { id, type, name, autocomplete, 'aria-label': ariaLabel, placeholder, boundingBox } = element;
  
  // We only emit signals if there's a bounding box
  if (!boundingBox || boundingBox.w === 0 || boundingBox.h === 0) return signals;

  // Normalization for easy string matching
  const safeName = (name || '').toLowerCase();
  const safeId = (id || '').toLowerCase();
  const safeAutocomplete = (autocomplete || '').toLowerCase();
  const safeType = (type || '').toLowerCase();
  const resolvedLabel = ((ariaLabel || '') + ' ' + (placeholder || '')).toLowerCase();

  const emit = (category: NormalizedSignal['category'], evidence: string) => {
    signals.push({
      signalId: `dom-${id || Math.random().toString(36).slice(2)}`,
      source: 'DOM_ANALYSIS',
      elementId: id || null,
      boundingBox,
      category,
      confidence: 1.0,
      evidence
    });
  };

  // 1. Password Rules
  if (safeType === 'password') {
    emit('PASSWORD', 'type=password');
  } else if (safeType === 'text' && (resolvedLabel.includes('password') || resolvedLabel.includes('pin'))) {
    emit('PASSWORD', 'type=text with password label');
  } else if (safeAutocomplete === 'current-password' || safeAutocomplete === 'new-password') {
    emit('PASSWORD', `autocomplete=${safeAutocomplete}`);
  }

  // 2. OTP Rules
  if (safeAutocomplete === 'one-time-code') {
    emit('OTP', 'autocomplete=one-time-code');
  } else if (safeName.includes('otp') || safeId.includes('otp') || resolvedLabel.includes('otp')) {
    emit('OTP', 'id/name/label includes otp');
  }

  // 3. Card Rules
  if (safeAutocomplete === 'cc-number') {
    emit('CARD_NUMBER', 'autocomplete=cc-number');
  } else if (safeAutocomplete === 'cc-csc') {
    // Typically we don't have a specific CVV category, we can map to CARD_NUMBER or generic
    emit('CARD_NUMBER', 'autocomplete=cc-csc');
  }

  // 4. Aadhaar/PAN
  if (safeName.includes('aadhaar') || safeId.includes('aadhaar') || resolvedLabel.includes('aadhaar')) {
    emit('AADHAAR', 'id/name/label includes aadhaar');
  }
  
  if (safeName.includes('pan') || safeId.includes('pan') || resolvedLabel.includes('pan')) {
    // "pan" can be generic, check for exact match or specific contexts
    if (safeName === 'pan' || safeName.includes('pannumber') || resolvedLabel.includes('pan number') || resolvedLabel.includes('permanent account number')) {
      emit('PAN', 'id/name/label includes pan');
    }
  }

  // 5. Account/IFSC -> mapped to GENERIC_PII or CARD_NUMBER depending on rules, let's use GENERIC_PII for now
  if (safeName.includes('ifsc') || safeName.includes('account') || resolvedLabel.includes('account number')) {
    emit('GENERIC_PII', 'id/name/label includes account/ifsc');
  }

  return signals;
}
