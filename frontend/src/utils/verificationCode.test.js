import { describe, expect, it } from 'vitest';
import { codeFromInput } from './verificationCode';

describe('codeFromInput', () => {
  it('keeps a plain code', () => expect(codeFromInput('123456')).toBe('123456'));
  it('drops the gap the email draws', () => expect(codeFromInput('123 456')).toBe('123456'));
  it('pulls the code out of its sentence', () => expect(codeFromInput('Your code is 123 456')).toBe('123456'));
  it('stops at six digits', () => expect(codeFromInput('1234567')).toBe('123456'));
  it('is empty for nothing', () => expect(codeFromInput(undefined)).toBe(''));
});
