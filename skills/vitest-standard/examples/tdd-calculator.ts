import { describe, it, expect } from 'vitest';

// 1. RED: Write a failing test first
describe('Calculator', () => {
  it('should add numbers', () => {
    const calc = new Calculator();
    expect(calc.add(2, 3)).toBe(5);
  });

  it('should multiply numbers', () => {
    const calc = new Calculator();
    expect(calc.multiply(2, 3)).toBe(6);
  });
});

// 2. GREEN: Minimal implementations 
class Calculator {
  // Red -> Green -> Refactor cycle
  add(a: number, b: number): number {
    return a + b;
  }

  // Next iteration:
  multiply(a: number, b: number): number {
    return a * b;
  }
}

// 3. REFACTOR (Example):
class ImprovedCalculator {
  // Drive the add method with any number of parameters
  add(...numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0);
  }
}

// 4. Test the refactored version
it('should add multiple numbers in ImprovedCalculator', () => {
  const calc = new ImprovedCalculator();
  expect(calc.add(1, 2, 3, 4)).toBe(10);
});
