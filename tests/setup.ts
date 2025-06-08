// Test setup file
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment defaults
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.WS_PORT = '3002';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';

// Global test timeout
jest.setTimeout(10000);

// Mock Redis for tests that don't need real Redis
jest.mock('../src/services/redis', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  smembers: jest.fn().mockResolvedValue([]),
  lpush: jest.fn().mockResolvedValue(1),
  ltrim: jest.fn().mockResolvedValue('OK'),
}));