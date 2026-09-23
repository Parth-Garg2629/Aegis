import type { SanitizationAction, SensitivityCategory } from '../types';

const CATEGORY_PRIORITY: Record<SensitivityCategory, number> = {
  PASSWORD: 1,
  OTP: 1,
  AADHAAR: 2,
  PAN: 2,
  CARD_NUMBER: 2,
  FACE: 3,
  EMAIL: 4,
  PHONE: 4,
  GENERIC_PII: 5,
  UI_ELEMENT: 6,
};

export function higherPriorityCategory(
  a: SensitivityCategory,
  b: SensitivityCategory,
): SensitivityCategory {
  return CATEGORY_PRIORITY[a] <= CATEGORY_PRIORITY[b] ? a : b;
}

export function mapCategoryToSanitizationAction(category: SensitivityCategory): SanitizationAction {
  if (category === 'FACE') return 'BLUR_VISUAL';
  return 'BLUR_AND_REPLACE';
}
