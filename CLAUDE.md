# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript in dist/
- `npm run dev` - Start development server with hot reload using ts-node-dev
- `npm start` - Run production server from compiled dist/

### Testing and Quality
- `npm test` - Run Jest test suite
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint on TypeScript files
- `npm run typecheck` - Run TypeScript compiler for type checking only

### Docker
- `docker-compose up` - Start full stack with Redis and Nginx
- `docker build .` - Build Docker image

**Pre-commit Check**: Always run `npm run build && npm run lint && npm run typecheck` before committing changes.

## Architecture Overview

### Core Components

**Gateway Service** (`src/services/gateway.ts`):
- Main WebSocket server handling MUD connections on port 8081
- Message routing between MUDs and broadcast capabilities
- Authentication and heartbeat management
- Connection state tracking with Redis persistence
- Event-driven message handling using EventEmitter

**Express API Server** (`src/index.ts`):
- HTTP API endpoints on port 8080 (default)
- RESTful endpoints for authentication, user management, and admin functions
- Security middleware (helmet, CORS, rate limiting)
- Graceful shutdown handling
- Health check endpoints

**Message System**:
- All communication uses structured JSON messages (MudVaultMessage interface)
- Message validation via Joi schemas in `src/utils/validation.ts`
- Message utilities in `src/utils/message.ts` for creating standard message types
- Support for tell, channel, who, finger, locate, presence, auth, ping/pong, error message types
- TTL-based message expiration (default 5 minutes)
- Message IDs use UUIDs for tracking

**Client Libraries**:
- **Built-in Node.js Client** (`src/clients/nodejs.ts`): MudVaultClient class for MUD integration
- **Standalone Node.js Package** (`packages/nodejs/`): Published as `mudvault-mesh` on npm
- **Python Package** (`packages/python/`): Published as `mudvault-mesh` on PyPI
- All clients feature auto-reconnection, heartbeat management, and event-driven APIs

### Key Services

- **Redis Service** (`src/services/redis.ts`): Connection state, message history, MUD registry, channel membership
- **User Service** (`src/services/user.ts`): User management, authentication, profile handling
- **Channel Service** (`src/services/channel.ts`): Multi-MUD chat channels with moderation features

### Protocol Implementation

This implements the MudVault Mesh Protocol v1.0 as defined in `docs/PROTOCOL.md`:
- WebSocket-based transport with JSON messaging
- Authentication via API keys or JWT tokens
- Comprehensive message types for inter-MUD communication
- Error handling with specific error codes (1000-1010 range)
- Version negotiation support
- UTF-8 encoding by default with metadata support

### Message Flow

1. MUD connects to WebSocket gateway and authenticates
2. Gateway validates auth and registers connection in Redis
3. Messages are validated, routed, and stored with TTL
4. Recipients receive messages in real-time if connected
5. Offline messages are queued and delivered on reconnection

## Important Technical Details

### TypeScript Configuration
- Strict mode enabled (`strict: true`)
- Target ES2020 with CommonJS modules
- Source maps and declarations generated
- Paths configured for clean imports

### Error Handling Pattern
```typescript
// All errors should follow this pattern:
throw new Error('Descriptive error message');
// Or use the error message utility:
sendErrorMessage(ws, 'error message', errorCode);
```

### Event System
The gateway uses EventEmitter for internal communication:
- `connection`: New MUD connected
- `disconnect`: MUD disconnected
- `message`: Message received
- `error`: Error occurred

### Redis Data Structures
- `mud:${mudName}`: MUD metadata and configuration
- `connections`: Active connection mapping
- `messages:${mudName}`: Message queue
- `channels:${channelName}`: Channel membership
- `users:${mudName}:${username}`: User profiles

### Security Considerations
- Rate limiting configured per IP and per MUD
- Message size limit: 64KB (configurable)
- JWT tokens expire after 24 hours
- API keys stored hashed in database
- CORS restricted to configured origins
- All input validated with Joi schemas

## Development Patterns

### Async/Await Usage
All async operations use async/await pattern:
```typescript
async function handleMessage(message: MudVaultMessage): Promise<void> {
  try {
    await validateMessage(message);
    await routeMessage(message);
  } catch (error) {
    logger.error('Message handling failed', error);
  }
}
```

### Logging
Use Winston logger with structured logging:
```typescript
logger.info('Operation completed', {
  mudName: 'example',
  duration: 100,
  metadata: { key: 'value' }
});
```

### Testing Approach
- Unit tests for utilities and pure functions
- Integration tests for services with Redis mocking
- E2E tests for WebSocket communication
- Use `describe` blocks for organization
- Mock external dependencies with Jest

## Client SDK Development

When working on client libraries:
1. Maintain consistent API across languages
2. Implement auto-reconnection with exponential backoff
3. Handle heartbeats automatically
4. Provide both async and event-based APIs
5. Include comprehensive type definitions
6. Follow language-specific conventions

## Deployment Notes

### Environment Variables
Key variables to configure:
- `NODE_ENV`: production/development
- `PORT`: API server port (default: 8080)
- `WS_PORT`: WebSocket port (default: 8081)
- `REDIS_URL`: Redis connection string
- `JWT_SECRET`: Secret for token signing
- `ALLOWED_ORIGINS`: CORS origins (comma-separated)

### Docker Deployment
- Multi-stage build reduces image size
- Non-root user for security
- Health checks configured
- Graceful shutdown handling
- Redis included in docker-compose

### Production Checklist
1. Set strong JWT_SECRET
2. Configure rate limits appropriately
3. Enable HTTPS via reverse proxy
4. Set up monitoring and alerting
5. Configure log aggregation
6. Implement backup strategy for Redis

## Current Project Status

### Completed Features
- Core gateway functionality
- WebSocket message routing
- Authentication system
- Channel management
- Redis integration
- Docker deployment
- Basic client libraries

### In Progress / Planned
- Comprehensive test coverage
- Advanced protocol features (media, P2P)
- Published client packages
- Additional documentation
- Monitoring dashboard
- Admin web interface

When implementing new features, ensure they align with the MudVault Mesh Protocol specification and maintain backward compatibility.