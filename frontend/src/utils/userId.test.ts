import { describe, it, expect, beforeEach } from 'vitest';
import { getUserId } from './userId';

describe('getUserId', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a valid UUID format', () => {
    const id = getUserId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('returns the same ID on subsequent calls', () => {
    const first = getUserId();
    const second = getUserId();
    expect(first).toBe(second);
  });

  it('persists to localStorage', () => {
    const id = getUserId();
    const stored = localStorage.getItem('user_id');
    expect(stored).toBe(id);
  });

  it('returns stored ID if already in localStorage', () => {
    const preExisting = '550e8400-e29b-41d4-a716-446655440000';
    localStorage.setItem('user_id', preExisting);
    const id = getUserId();
    expect(id).toBe(preExisting);
  });

  it('generates new ID if stored value is invalid', () => {
    localStorage.setItem('user_id', 'not-a-valid-uuid');
    const id = getUserId();
    expect(id).not.toBe('not-a-valid-uuid');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
