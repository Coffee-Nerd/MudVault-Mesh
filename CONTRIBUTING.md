# Contributing to MudVault Mesh

Thank you for your interest in contributing to MudVault Mesh! This document provides guidelines and information for contributors.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Making Changes](#making-changes)
5. [Testing](#testing)
6. [Pull Request Process](#pull-request-process)
7. [Coding Standards](#coding-standards)
8. [Commit Guidelines](#commit-guidelines)

## Code of Conduct

This project adheres to a Code of Conduct that we expect all contributors to follow:

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on what's best for the community
- Show empathy towards other community members
- Be collaborative and constructive in discussions

## Getting Started

### Prerequisites

- Node.js 16.x or higher
- npm 8.x or higher
- Redis 6.x or higher
- Git

### Development Environment

1. **Fork the repository**
   ```bash
   # Fork on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/OpenIMC.git
   cd OpenIMC
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis**
   ```bash
   # Using Docker
   docker run -d -p 6379:6379 redis:7-alpine
   
   # Or install locally
   redis-server
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

## Development Setup

### Project Structure

```
src/
├── clients/          # Client library implementations
├── middleware/       # Express middleware
├── routes/          # API routes
├── services/        # Core services (Gateway, Redis, etc.)
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── index.ts         # Main entry point

tests/
├── unit/            # Unit tests
├── integration/     # Integration tests
└── setup.ts         # Test setup

docs/
├── PROTOCOL.md      # Protocol specification
├── COMMANDS.md      # Command reference
└── IMPLEMENTATION_GUIDE.md  # Implementation guide
```

### Available Scripts

```bash
# Development
npm run dev          # Start development server with hot reload
npm run build        # Build production bundle
npm start           # Start production server

# Testing
npm test            # Run all tests
npm run test:unit   # Run unit tests only
npm run test:integration  # Run integration tests only
npm run test:coverage     # Run tests with coverage report
npm run test:watch  # Run tests in watch mode

# Code Quality
npm run lint        # Run ESLint
npm run lint:fix    # Fix ESLint issues
npm run typecheck   # Run TypeScript type checking
npm run format      # Format code with Prettier
npm run format:check # Check code formatting

# Pre-commit checks
npm run precommit   # Run linting, type checking, and unit tests
```

## Making Changes

### Branch Naming

Use descriptive branch names with prefixes:

- `feature/add-new-command` - New features
- `fix/authentication-bug` - Bug fixes
- `docs/update-protocol-spec` - Documentation updates
- `refactor/gateway-cleanup` - Code refactoring
- `test/integration-coverage` - Test improvements

### Workflow

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write code following our coding standards
   - Add tests for new functionality
   - Update documentation as needed

3. **Test your changes**
   ```bash
   npm run precommit  # Run all pre-commit checks
   npm run test:integration  # Run integration tests
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new command support"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   # Create pull request on GitHub
   ```

## Testing

### Test Requirements

All contributions must include appropriate tests:

- **Unit tests** for individual functions and classes
- **Integration tests** for API endpoints and services
- **Protocol tests** for WebSocket message handling

### Writing Tests

#### Unit Tests

```typescript
// tests/unit/validation.test.ts
import { validateMessage } from '../../src/utils/validation';

describe('validateMessage', () => {
  test('should validate correct message format', () => {
    const message = {
      version: '1.0',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      type: 'tell',
      from: { mud: 'TestMUD' },
      to: { mud: 'TargetMUD' },
      payload: { message: 'Hello' },
      metadata: { priority: 5, ttl: 300, encoding: 'utf-8', language: 'en' }
    };

    const result = validateMessage(message);
    expect(result.error).toBeUndefined();
    expect(result.value).toBeDefined();
  });
});
```

#### Integration Tests

```typescript
// tests/integration/api.integration.test.ts
import request from 'supertest';
import app from '../../src/app';

describe('API Endpoints', () => {
  test('GET /health should return 200', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body.status).toBe('healthy');
  });
});
```

### Test Coverage

Maintain minimum test coverage:
- **80%** line coverage
- **80%** function coverage
- **70%** branch coverage

Check coverage with:
```bash
npm run test:coverage
```

## Pull Request Process

### Before Submitting

1. **Run all checks**
   ```bash
   npm run precommit
   npm run test:integration
   ```

2. **Update documentation**
   - Update README if needed
   - Add/update JSDoc comments
   - Update CHANGELOG.md

3. **Self-review**
   - Check for console.log statements
   - Ensure no hardcoded values
   - Verify error handling

### PR Requirements

- **Descriptive title** following conventional commits
- **Clear description** of changes made
- **Issue reference** if applicable (Fixes #123)
- **Screenshots** for UI changes
- **Breaking changes** clearly documented

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No console.log statements
```

### Review Process

1. **Automated checks** must pass (CI/CD)
2. **Code review** by maintainers
3. **Testing** in staging environment
4. **Approval** from core team member
5. **Merge** to main branch

## Coding Standards

### TypeScript Guidelines

- Use **strict mode** TypeScript
- Prefer **interfaces** over types for object shapes
- Use **enums** for constants
- Add **JSDoc** comments for public APIs

```typescript
/**
 * Validates a MudVault Mesh message
 * @param message - The message to validate
 * @returns Validation result with value or error
 */
export function validateMessage(message: any): ValidationResult {
  // Implementation
}
```

### Code Style

- **2 spaces** for indentation
- **Single quotes** for strings
- **Trailing commas** in objects/arrays
- **Semicolons** at end of statements
- **Camel case** for variables and functions
- **Pascal case** for classes and interfaces

### Error Handling

```typescript
// Good: Specific error types
throw new ValidationError('Invalid message format');

// Good: Error context
logger.error('Message validation failed', {
  messageId: message.id,
  error: error.message
});

// Avoid: Generic errors
throw new Error('Something went wrong');
```

### Logging

```typescript
// Use structured logging
logger.info('User connected', {
  mudName: connectionInfo.mudName,
  ipAddress: connectionInfo.host,
  timestamp: new Date()
});

// Use appropriate log levels
logger.debug('Debug information');
logger.info('General information');
logger.warn('Warning condition');
logger.error('Error condition');
```

## Commit Guidelines

### Conventional Commits

Use [Conventional Commits](https://conventionalcommits.org/) format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Commit Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```bash
feat(gateway): add finger command support
fix(auth): resolve JWT token validation issue
docs(protocol): update message format specification
test(integration): add WebSocket connection tests
```

### Commit Body

For complex changes, include:
- **What** changed
- **Why** it was changed
- **Any breaking changes**
- **Migration notes** if needed

## Documentation

### Code Documentation

- **JSDoc comments** for all public APIs
- **Inline comments** for complex logic
- **README updates** for new features
- **Type definitions** with descriptions

### Protocol Documentation

When adding new message types or modifying existing ones:

1. Update `docs/PROTOCOL.md`
2. Add examples to `docs/COMMANDS.md`
3. Update implementation guide if needed
4. Add integration tests

## Security

### Security Guidelines

- **Never commit secrets** (use environment variables)
- **Validate all inputs** before processing
- **Use parameterized queries** for database operations
- **Sanitize user data** before displaying
- **Follow OWASP guidelines** for web security

### Reporting Security Issues

Report security vulnerabilities privately:
- Email: security@mudvault.org
- Include detailed description
- Provide reproduction steps
- Allow time for fix before disclosure

## Getting Help

### Resources

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/OpenIMC/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/OpenIMC/discussions)
- **Discord**: [Community Discord](#)

### Asking Questions

When asking for help:
1. **Search existing issues** first
2. **Provide context** about what you're trying to do
3. **Include error messages** and logs
4. **Share relevant code** snippets
5. **Describe what you've tried** already

### Contribution Recognition

Contributors are recognized in:
- **README.md** contributors section
- **CHANGELOG.md** for significant contributions
- **Release notes** for major features
- **Discord** contributor role

Thank you for contributing to MudVault Mesh! 🎮