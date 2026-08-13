import { jest } from '@jest/globals';

// Global test setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
});

afterAll(() => {
  jest.clearAllMocks();
});

// Mock timers for deterministic tests
jest.useFakeTimers();

// Extend Jest matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor}-${ceiling}`
          : `expected ${received} to be within range ${floor}-${ceiling}`,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(floor: number, ceiling: number): R;
    }
  }
}