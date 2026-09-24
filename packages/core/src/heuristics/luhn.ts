// Luhn algorithm for Credit Card validation (D1)

export function validateLuhn(numStr: string): boolean {
  if (!/^\d+$/.test(numStr)) return false;

  let sum = 0;
  let isAlternate = false;

  // Process right to left
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = parseInt(numStr.charAt(i), 10);
    
    if (isAlternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    
    sum += n;
    isAlternate = !isAlternate;
  }
  
  return sum % 10 === 0;
}
