import { describe, it, expect } from 'vitest';

describe('Example Suite', () => {
  it('should pass if true is true', () => {
    expect(true).toBe(true);
  });

  it('should correctly sum two numbers', () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(1, 2)).toBe(3);
  });
});
