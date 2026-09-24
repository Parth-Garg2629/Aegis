import { describe, it, expect } from 'vitest';
import { detectPii } from '../src/heuristics';
import { validateVerhoeff } from '../src/heuristics/verhoeff';
import { validateLuhn } from '../src/heuristics/luhn';

describe('Heuristics D1', () => {
  it('detects a valid Aadhaar number with confidence 1.0', () => {
    // Generate a mathematically valid verhoeff sequence (mock for testing: we know '123456789012' is NOT valid but we can find one that is)
    // Actually, '499118534151' is a known valid verifiable test sequence often used, or we just rely on the math.
    // Let's test Verhoeff separately first.
    
    // For Aadhaar, let's just use the validate function to find a valid one
    let validAadhaar = "234567890123";
    for(let i=0; i<10; i++) {
        if(validateVerhoeff("23456789012" + i)) {
            validAadhaar = "23456789012" + i;
            break;
        }
    }
    
    const results = detectPii(`My aadhaar is ${validAadhaar}.`);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('AADHAAR');
    expect(results[0].confidence).toBe(1.0);
    expect(results[0].evidence).not.toContain(validAadhaar);
  });

  it('detects an invalid-checksum Aadhaar with confidence 0.4', () => {
    let invalidAadhaar = "234567890123";
    for(let i=0; i<10; i++) {
        if(!validateVerhoeff("23456789012" + i)) {
            invalidAadhaar = "23456789012" + i;
            break;
        }
    }
    const results = detectPii(`Fake aadhaar ${invalidAadhaar} here.`);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('AADHAAR');
    expect(results[0].confidence).toBe(0.4);
  });

  it('detects PAN cards', () => {
    const results = detectPii('Here is my PAN ABCDE1234F.');
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('PAN');
    expect(results[0].confidence).toBe(1.0);
  });

  it('detects emails', () => {
    const results = detectPii('Contact me at test@example.com for more info.');
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('EMAIL');
    expect(results[0].confidence).toBe(1.0);
  });

  it('detects phone numbers', () => {
    const results = detectPii('Call +91 9876543210 today.');
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('PHONE');
    expect(results[0].confidence).toBe(1.0);
  });

  it('deduplicates overlapping matches properly', () => {
    // 16-digit valid Luhn
    let validCard = "411111111111111";
    for(let i=0; i<10; i++) {
        if(validateLuhn("411111111111111" + i)) {
            validCard = "411111111111111" + i;
            break;
        }
    }
    const results = detectPii(`Card: ${validCard}`);
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('CARD_NUMBER');
  });
});
