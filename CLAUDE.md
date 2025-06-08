# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run build` - Compile TypeScript to JavaScript in dist/
- `npm run dev` - Start development server with hot reload using ts-node-dev
- `npm start` - Run production server from compiled dist/

### Testing and Quality
- `npm test` - Run Jest test suite (note: no tests currently exist)
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint on TypeScript files
- `npm run typecheck` - Run TypeScript compiler for type checking only

### Docker
- `docker-compose up` - Start full stack with Redis
- `docker build .` - Build Docker image

## Architecture Overview

### Core Components

**Gateway Service** (`src/services/gateway.ts`):
- Main WebSocket server handling MUD connections
- Message routing between MUDs and broadcast capabilities
- Authentication and heartbeat management
- Connection state tracking with Redis persistence

**Express API Server** (`src/index.ts`):
- HTTP API endpoints on port 8080 (default)
- WebSocket gateway on port 8081 (default)
- Security middleware (helmet, CORS, rate limiting)
- Graceful shutdown handling

**Message System**:
- All communication uses structured JSON messages (OpenIMCMessage interface)
- Message validation via Joi schemas in `src/utils/validation.ts`
- Message utilities in `src/utils/message.ts` for creating standard message types
- Support for tell, channel, who, finger, locate, presence, auth, ping/pong, error message types

**Client Library** (`src/clients/nodejs.ts`):
- OpenIMCClient class for connecting MUDs to gateway
- Event-driven architecture with auto-reconnection
- Heartbeat management and connection state tracking
- Helper methods for common operations (sendTell, joinChannel, etc.)

### Key Services

- **Redis Service** (`src/services/redis.ts`): Connection state, message history, MUD registry
- **User Service** (`src/services/user.ts`): User management and authentication
- **Channel Service** (`src/services/channel.ts`): Multi-MUD chat channels with moderation

### Protocol Implementation

This implements the OpenIMC protocol as defined in `docs/PROTOCOL.md`:
- WebSocket-based transport with JSON messaging
- Authentication via API keys or JWT tokens
- Comprehensive message types for inter-MUD communication
- Error handling with specific error codes (1000-1010 range)

## Important Notes

### Missing Components
- **No tests exist**: Jest is configured but no test files are present
- **Client libraries not published**: Referenced packages `openimc` (Python) and `openimc-client` (Node.js) don't exist yet
- **Missing documentation**: Several docs referenced in README don't exist (MIGRATION.md, SECURITY.md)

### Environment Configuration
- Uses dotenv for environment variables
- Redis connection required for operation
- Supports both development and production modes
- Configurable ports, CORS origins, and security settings

### Code Patterns
- TypeScript with strict mode enabled
- Event-driven architecture using EventEmitter
- Async/await pattern throughout
- Comprehensive error handling with structured error messages
- Winston logger for structured logging

### Security Features
- Helmet for HTTP security headers
- CORS configuration with allowlist
- Rate limiting via rate-limiter-flexible
- JWT authentication support
- API key validation
- Message size limits (64KB default)

When working on this codebase, always run `npm run build && npm run lint && npm run typecheck` before committing changes.