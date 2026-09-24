import type { SensitivityCategory } from '../types';
import { validateVerhoeff } from './verhoeff';
import { validateLuhn } from './luhn';
import { stripSeparators } from './normalize';

export interface PiiSpan {
  start: number;
  end: number;
}

export interface PiiDetectionResult {
  category: SensitivityCategory;
  confidence: number;
  span: PiiSpan;
  evidence: string;
}

const PATTERNS = {
  // 12 digits, optional spaces/dashes, not starting with 0 or 1
  AADHAAR: /\b[2-9]\d{3}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  
  // 5 uppercase alpha, 4 digits, 1 uppercase alpha
  PAN: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  
  // 13-19 digits, optional spaces/dashes
  CARD_NUMBER: /\b(?:\d[ -]*?){13,19}\b/g,
  
  // Basic email pattern
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  
  // Phone: +91, 0, or plain 10 digits
  PHONE: /(?:\+?91|0)?[ -]*?[6-9](?:\d[ -]*?){9}\b/g,
};

export function detectPii(text: string): PiiDetectionResult[] {
  const results: PiiDetectionResult[] = [];
  
  // AADHAAR
  for (const match of text.matchAll(PATTERNS.AADHAAR)) {
    const rawMatch = match[0];
    const normalized = stripSeparators(rawMatch);
    
    // Aadhaar must be 12 digits
    if (normalized.length === 12) {
      const isValid = validateVerhoeff(normalized);
      results.push({
        category: 'AADHAAR',
        confidence: isValid ? 1.0 : 0.4, // G-03 fail-safe over-redaction
        span: { start: match.index!, end: match.index! + rawMatch.length },
        evidence: 'aadhaar_pattern_match',
      });
    }
  }
  
  // PAN
  for (const match of text.matchAll(PATTERNS.PAN)) {
    const rawMatch = match[0];
    results.push({
      category: 'PAN',
      confidence: 1.0,
      span: { start: match.index!, end: match.index! + rawMatch.length },
      evidence: 'pan_pattern_match',
    });
  }
  
  // CARD NUMBER
  for (const match of text.matchAll(PATTERNS.CARD_NUMBER)) {
    const rawMatch = match[0];
    const normalized = stripSeparators(rawMatch);
    
    // Ignore if already matched by Aadhaar (Aadhaar is 12, Card is 13-19, but just in case)
    if (normalized.length >= 13 && normalized.length <= 19) {
      // Must not be all same digits
      if (!/^(\d)\1+$/.test(normalized)) {
        const isValid = validateLuhn(normalized);
        results.push({
          category: 'CARD_NUMBER',
          confidence: isValid ? 1.0 : 0.4,
          span: { start: match.index!, end: match.index! + rawMatch.length },
          evidence: 'card_pattern_match',
        });
      }
    }
  }

  // EMAIL
  for (const match of text.matchAll(PATTERNS.EMAIL)) {
    const rawMatch = match[0];
    results.push({
      category: 'EMAIL',
      confidence: 1.0,
      span: { start: match.index!, end: match.index! + rawMatch.length },
      evidence: 'email_pattern_match',
    });
  }

  // PHONE
  for (const match of text.matchAll(PATTERNS.PHONE)) {
    const rawMatch = match[0];
    const normalized = stripSeparators(rawMatch);
    
    // Need to have 10, 11 (0+10), or 12 (91+10) digits
    if (normalized.length === 10 || (normalized.length === 11 && normalized.startsWith('0')) || (normalized.length === 12 && normalized.startsWith('91'))) {
       // Filter out trivial patterns to reduce false positives
       if (!/^(\d)\1+$/.test(normalized.slice(-10))) {
         results.push({
           category: 'PHONE',
           confidence: 1.0,
           span: { start: match.index!, end: match.index! + rawMatch.length },
           evidence: 'phone_pattern_match',
         });
       }
    }
  }
  
  return deduplicateResults(results);
}

// Helper to remove overlaps (higher confidence / priority wins)
function deduplicateResults(results: PiiDetectionResult[]): PiiDetectionResult[] {
  // Sort by length of match descending, then confidence descending
  const sorted = [...results].sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    if (lenA !== lenB) return lenB - lenA;
    return b.confidence - a.confidence;
  });

  const finalResults: PiiDetectionResult[] = [];
  
  for (const res of sorted) {
    const overlaps = finalResults.some(existing => 
      res.span.start < existing.span.end && res.span.end > existing.span.start
    );
    
    if (!overlaps) {
      finalResults.push(res);
    }
  }
  
  return finalResults.sort((a, b) => a.span.start - b.span.start);
}
