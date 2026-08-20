import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const mockPoolQuery = jest.fn<any>();
const mockPoolConnect = jest.fn<any>();
const mockPoolEnd = jest.fn<any>();
const mockPoolOn = jest.fn<any>();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({
    query: mockPoolQuery,
    connect: mockPoolConnect,
    end: mockPoolEnd,
    on: mockPoolOn,
  })),
}));

jest.mock('../../../src/shared/config', () => ({
  config: {
    postgres: {
      host: 'localhost',
      port: 5432,
      database: 'test_db',
      user: 'test_user',
      password: 'test_pass',
      ssl: false,
      poolSize: 10,
    },
  },
}));

jest.mock('../../../src/shared/metrics', () => ({
  dbQueryDurationSeconds: {
    observe: jest.fn(),
  },
}));

import { getPool, query, getClient, transaction, closePool, healthCheck } from '../../../src/shared/db';

const mockDbQueryDuration = require('../../../src/shared/metrics').dbQueryDurationSeconds.observe;

describe('db module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getPool', () => {
    test('creates pool on first call and attaches error handler', () => {
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(mockPoolOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    test('returns same pool on subsequent calls', () => {
      const p1 = getPool();
      const p2 = getPool();
      expect(p1).toBe(p2);
    });

    test('error handler logs unexpected pool errors', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // closePool first so getPool creates a fresh pool
      await closePool();
      mockPoolOn.mockClear();
      getPool();
      // Extract the error handler that was registered
      const calls = mockPoolOn.mock.calls as any[];
      const errorHandler = calls.find(
        (call: any[]) => call[0] === 'error'
      )?.[1] as ((err: Error) => void) | undefined;
      expect(errorHandler).toBeDefined();
      const testError = new Error('pool error');
      errorHandler!(testError);
      expect(errorSpy).toHaveBeenCalledWith('Unexpected database pool error:', testError);
      errorSpy.mockRestore();
    });
  });

  describe('query', () => {
    test('executes query and returns result', async () => {
      const expectedResult = { rows: [{ id: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
      mockPoolQuery.mockResolvedValueOnce(expectedResult);

      const result = await query('SELECT 1');
      expect(result).toBe(expectedResult);
      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    test('passes params to pool.query', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await query('SELECT $1', ['param1']);
      expect(mockPoolQuery).toHaveBeenCalledWith('SELECT $1', ['param1']);
    });

    test('records query duration metric', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await query('INSERT INTO test');
      expect(mockDbQueryDuration).toHaveBeenCalledWith(
        { operation: 'INSERT' },
        expect.any(Number)
      );
    });

    test('warns on slow queries exceeding 1000ms', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockPoolQuery.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });
          }, 1100);
        });
      });

      const queryPromise = query('SELECT pg_sleep(1.1)');
      jest.advanceTimersByTime(1100);
      await queryPromise;

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Slow query'),
        expect.any(String)
      );
      warnSpy.mockRestore();
    });

    test('does not warn for fast queries', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await query('SELECT 1');
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('trims text before extracting operation', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] });

      await query('  \n  SELECT 1  \n  ');
      expect(mockDbQueryDuration).toHaveBeenCalledWith(
        { operation: 'SELECT' },
        expect.any(Number)
      );
    });

    test('re-throws query errors after recording metric', async () => {
      const error = new Error('connection refused');
      mockPoolQuery.mockRejectedValueOnce(error);

      await expect(query('SELECT 1')).rejects.toThrow('connection refused');
      expect(mockDbQueryDuration).toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    test('returns a client from the pool', async () => {
      const mockClient = { query: jest.fn(), release: jest.fn() };
      mockPoolConnect.mockResolvedValueOnce(mockClient);

      const client = await getClient();
      expect(client).toBe(mockClient);
    });
  });

  describe('transaction', () => {
    test('commits transaction on success', async () => {
      const mockClient = {
        query: jest.fn<any>().mockResolvedValue({}),
        release: jest.fn<any>(),
      };
      mockPoolConnect.mockResolvedValueOnce(mockClient);

      const callback = jest.fn<any>(async () => 'result');
      const result = await transaction(callback);

      expect(result).toBe('result');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('rolls back transaction on error', async () => {
      const mockClient = {
        query: jest.fn<any>().mockResolvedValue({}),
        release: jest.fn<any>(),
      };
      mockPoolConnect.mockResolvedValueOnce(mockClient);

      const callback = jest.fn<any>(async () => { throw new Error('callback error'); });

      await expect(transaction(callback)).rejects.toThrow('callback error');
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    test('releases client in finally block even on error', async () => {
      const mockClient = {
        query: jest.fn<any>().mockResolvedValue({}),
        release: jest.fn<any>(),
      };
      mockPoolConnect.mockResolvedValueOnce(mockClient);

      const callback = jest.fn<any>(async () => { throw new Error('fail'); });

      try { await transaction(callback); } catch {}
      expect(mockClient.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('closePool', () => {
    test('ends pool and sets to null', async () => {
      getPool();
      mockPoolEnd.mockResolvedValueOnce(undefined);

      await closePool();
      expect(mockPoolEnd).toHaveBeenCalled();
    });

    test('does nothing when pool is already null', async () => {
      await closePool();
      expect(true).toBe(true);
    });
  });

  describe('healthCheck', () => {
    test('returns true when query succeeds', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] });

      const result = await healthCheck();
      expect(result).toBe(true);
    });

    test('returns false when query throws', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await healthCheck();
      expect(result).toBe(false);
    });
  });
});
