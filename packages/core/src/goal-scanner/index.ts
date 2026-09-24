import type { SensitivityCategory } from '../types';
import { detectPii } from '../heuristics';

export interface GoalScanResult {
  hasSensitiveContent: boolean;
  categories: SensitivityCategory[];
  sanitizedGoal: string;
}

const GOAL_RISK_KEYWORDS = [
  'delete', 'transfer', 'payment', 'submit', 'confirm', 
  'clear', 'wipe', 'logout', 'unsubscribe', 'purchase', 
  'buy', 'send money'
];

export function scanGoal(goalText: string): GoalScanResult {
  if (!goalText) {
    return { hasSensitiveContent: false, categories: [], sanitizedGoal: '' };
  }

  const piiResults = detectPii(goalText);
  let sanitizedGoal = goalText;
  const categories = new Set<SensitivityCategory>();
  
  let hasSensitiveContent = false;

  // Replace back to front to preserve indices
  const sortedPii = [...piiResults].sort((a, b) => b.span.start - a.span.start);
  
  for (const res of sortedPii) {
    hasSensitiveContent = true;
    categories.add(res.category);
    const placeholder = `[REDACTED_${res.category}]`;
    sanitizedGoal = sanitizedGoal.substring(0, res.span.start) + placeholder + sanitizedGoal.substring(res.span.end);
  }
  
  const lowerGoal = goalText.toLowerCase();
  for (const keyword of GOAL_RISK_KEYWORDS) {
    if (lowerGoal.includes(keyword)) {
       // We just note it's risky, but we don't redact the keyword itself, we just return the flag 
       // to warn the user, or rely on the risk engine. The spec says warn but scrub PII.
       hasSensitiveContent = true;
       categories.add('GENERIC_PII'); // Or a specific risk category if we had one
    }
  }

  return {
    hasSensitiveContent,
    categories: Array.from(categories),
    sanitizedGoal,
  };
}
