// Normalization utilities for PII heuristics (D1)

// Maps unicode fullwidth digits and arabic-indic numerals to ASCII digits
const UNICODE_DIGIT_MAP: Record<string, string> = {
  // Fullwidth
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  // Arabic-Indic
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  // Eastern Arabic-Indic
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9'
};

/**
 * Normalizes digits to ASCII, and strips non-alphanumeric characters like spaces, dashes.
 * Useful for PAN, Aadhaar, Credit Cards.
 */
export function normalizeAlphanumeric(text: string): string {
  let normalized = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (UNICODE_DIGIT_MAP[char]) {
      normalized += UNICODE_DIGIT_MAP[char];
    } else if (/[a-zA-Z0-9]/.test(char)) {
      normalized += char;
    }
  }
  return normalized;
}

/**
 * Strips formatting but keeps alphanumeric. (e.g. "1234-5678-9012" -> "123456789012")
 */
export function stripSeparators(text: string): string {
  return normalizeAlphanumeric(text);
}
