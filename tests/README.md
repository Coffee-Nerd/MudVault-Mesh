# Testing Guide for MudVault Mesh

This directory contains comprehensive tests for the MudVault Mesh protocol implementation.

## Test Structure

```
tests/
├── unit/                 # Unit tests for individual functions/classes
│   ├── validation.test.ts
│   ├── message.test.ts
│   └── gateway.test.ts
├── integration/          # Integration tests for services
│   ├── gateway.integration.test.ts
│   └── api.integration.test.ts
├── setup.ts             # Test environment setup
└── README.md           # This file
```

## Running Tests

### All Tests
```bash
npm test                 # Run all tests once
npm run test:watch      # Run tests in watch mode
```

### Specific Test Types
```bash
npm run test:unit       # Unit tests only
npm run test:integration # Integration tests only
npm run test:coverage   # All tests with coverage report
```

### Individual Test Files
```bash
npx jest validation.test.ts              # Single file
npx jest --testNamePattern="validate"    # Tests matching pattern
npx jest --verbose                       # Detailed output
```

## Test Categories

### 1. Unit Tests (`tests/unit/`)

Test individual functions and classes in isolation:

- **validation.test.ts**: Message validation, MUD name validation
- **message.test.ts**: Message creation utilities
- **gateway.test.ts**: Gateway class methods
- **redis.test.ts**: Redis service operations
- **auth.test.ts**: Authentication middleware

### 2. Integration Tests (`tests/integration/`)

Test interactions between components:

- **gateway.integration.test.ts**: WebSocket communication flow
- **api.integration.test.ts**: HTTP API endpoints
- **protocol.integration.test.ts**: Full protocol compliance

### 3. End-to-End Tests

Full system tests against live server:

- **test-messages.js**: Basic protocol commands
- **test-additional-commands.js**: Advanced protocol features

## Test Environment Setup

### Prerequisites

1. **Redis Server**: Required for integration tests
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:7-alpine
   
   # Or install locally
   redis-server
   ```

2. **Environment Variables**: Set in `tests/setup.ts`
   ```bash
   NODE_ENV=test
   REDIS_URL=redis://localhost:6379
   JWT_SECRET=test-secret-key
   LOG_LEVEL=error
   ```

### Test Database

Integration tests use a separate Redis database (`DB 1`) to avoid conflicts with development data.

## Writing Tests

### Unit Test Example

```typescript
// tests/unit/example.test.ts
import { functionToTest } from '../../src/utils/example';

describe('functionToTest', () => {
  test('should handle valid input', () => {
    const result = functionToTest('valid-input');
    expect(result).toBe('expected-output');
  });

  test('should throw error for invalid input', () => {
    expect(() => functionToTest('invalid')).toThrow('Invalid input');
  });
});
```

### Integration Test Example

```typescript
// tests/integration/example.integration.test.ts
import WebSocket from 'ws';
import { Gateway } from '../../src/services/gateway';

describe('Gateway Integration', () => {
  let gateway: Gateway;
  let ws: WebSocket;

  beforeAll(async () => {
    gateway = new Gateway();
    await gateway.start(9999);
  });

  afterAll(() => {
    gateway.stop();
  });

  test('should accept WebSocket connections', async () => {
    ws = new WebSocket('ws://localhost:9999');
    await new Promise(resolve => ws.on('open', resolve));
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});
```

## Test Utilities

Common test utilities are available in `tests/helpers/`:

### Message Builders
```typescript
import { createTestMessage } from '../helpers/messageBuilder';

const tellMessage = createTestMessage('tell', {
  from: { mud: 'TestMUD', user: 'TestUser' },
  to: { mud: 'TargetMUD', user: 'TargetUser' },
  payload: { message: 'Hello' }
});
```

### Mock Services
```typescript
import { mockRedisService } from '../helpers/mocks';

// Mock Redis in tests
const redis = mockRedisService();
redis.get.mockResolvedValue('test-value');
```

### WebSocket Test Client
```typescript
import { TestWebSocketClient } from '../helpers/wsClient';

const client = new TestWebSocketClient();
await client.connect('ws://localhost:8081');
await client.authenticate('TestMUD');
const response = await client.sendMessage(message);
```

## Coverage Requirements

Maintain minimum coverage thresholds:

| Metric | Threshold |
|--------|-----------|
| Lines | 80% |
| Functions | 80% |
| Branches | 70% |
| Statements | 80% |

### Coverage Reports

- **Terminal**: `npm run test:coverage`
- **HTML**: `coverage/lcov-report/index.html`
- **LCOV**: `coverage/lcov.info`

## Continuous Integration

Tests run automatically on:

- **Pull Requests**: All tests must pass
- **Main Branch**: Full test suite including integration tests
- **Nightly**: Extended test suite with performance tests

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
- name: Run tests with coverage
  run: npm run test:coverage
  env:
    NODE_ENV: test
    REDIS_URL: redis://localhost:6379
```

## Test Data

### Static Test Data
Located in `tests/fixtures/`:
- `messages.json`: Sample protocol messages
- `users.json`: Test user data
- `configs.json`: Test configurations

### Dynamic Test Data
Generated during tests:
- Random UUIDs for message IDs
- Timestamps for current test run
- Unique MUD names to avoid conflicts

## Performance Testing

### Load Tests
```bash
# Run load tests against local server
npm run test:load

# Run against production server
TEST_URL=wss://prod.mudvault.org npm run test:load
```

### Memory Leak Detection
```bash
# Monitor memory usage during tests
npm run test:memory
```

## Debugging Tests

### Debug Single Test
```bash
# Run with debugging enabled
npx jest --runInBand --detectOpenHandles validation.test.ts
```

### Debug Integration Tests
```bash
# Enable verbose logging
LOG_LEVEL=debug npm run test:integration
```

### Common Issues

1. **Redis Connection Errors**
   - Ensure Redis is running on port 6379
   - Check `REDIS_URL` environment variable

2. **Port Already in Use**
   - Integration tests use random ports
   - Check for hanging processes: `lsof -i :8081`

3. **Timeout Errors**
   - Increase Jest timeout: `--testTimeout=30000`
   - Check for async operations without proper await

## Test Documentation

### Test Coverage Reports
- View current coverage: [Coverage Report](../coverage/lcov-report/index.html)
- CI/CD coverage: Check GitHub Actions artifacts

### Test Results
- Local results: Terminal output
- CI results: GitHub Actions workflow logs
- Coverage trends: Codecov integration

## Contributing Tests

When adding new features:

1. **Write tests first** (TDD approach)
2. **Include both unit and integration tests**
3. **Maintain coverage thresholds**
4. **Update test documentation**
5. **Add protocol compliance tests** for new message types

### Test Checklist

- [ ] Unit tests for new functions
- [ ] Integration tests for new features
- [ ] Protocol tests for new message types
- [ ] Error handling tests
- [ ] Edge case coverage
- [ ] Documentation updated
- [ ] Coverage maintained above thresholds