# OpenIMC Protocol Specification v1.0

This document defines the OpenIMC (Open Inter-MUD Communication) protocol, a modern replacement for legacy IMC protocols that enables seamless communication between MUD (Multi-User Dungeon) servers.

## Table of Contents

- [Overview](#overview)
- [Core Concepts](#core-concepts)
- [Message Format](#message-format)
- [Transport Layer](#transport-layer)
- [Authentication](#authentication)
- [Message Types](#message-types)
- [Error Handling](#error-handling)
- [Security](#security)
- [Extension Mechanism](#extension-mechanism)

## Overview

OpenIMC is designed with the following principles:

- **Modern Standards**: Built on WebSocket, JSON, and HTTP/REST
- **Language Agnostic**: Works with any programming language
- **Secure by Default**: TLS encryption and authentication required
- **Extensible**: Plugin architecture for custom functionality
- **Decentralized**: P2P capability with no single point of failure
- **Backward Compatible**: Bridges to legacy IMC2/IMC3 protocols

## Core Concepts

### Message-Driven Architecture

All communication in OpenIMC is message-based. Each message is a JSON object that contains:
- Metadata about the message itself
- Routing information (from/to)
- Type-specific payload
- Optional security information

### Gateway Nodes

OpenIMC operates through gateway nodes that:
- Accept connections from MUD servers
- Route messages between MUDs
- Provide REST API endpoints
- Handle authentication and rate limiting
- Maintain connection state

### Decentralized Network

While individual gateways serve as connection points, the overall network is decentralized:
- Gateways can communicate with each other
- No single point of failure
- Automatic failover and load balancing
- DHT-based MUD discovery (future)

## Message Format

All OpenIMC messages follow a standardized JSON format:

```json
{
  "version": "1.0",
  "id": "uuid-v4-string",
  "timestamp": "2025-01-08T12:00:00.000Z",
  "type": "message-type",
  "from": {
    "mud": "SenderMUDName",
    "user": "optional-username",
    "displayName": "Optional Display Name"
  },
  "to": {
    "mud": "TargetMUDName",
    "user": "optional-username", 
    "channel": "optional-channel-name"
  },
  "payload": {
    // Type-specific content
  },
  "signature": "optional-cryptographic-signature",
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8",
    "language": "en",
    "retry": false
  }
}
```

### Field Definitions

#### Required Fields

- **version**: Protocol version (currently "1.0")
- **id**: Unique message identifier (UUID v4)
- **timestamp**: ISO 8601 timestamp when message was created
- **type**: Message type (see [Message Types](#message-types))
- **from**: Source endpoint information
- **to**: Destination endpoint information
- **payload**: Type-specific message content
- **metadata**: Message metadata and delivery options

#### Optional Fields

- **signature**: Cryptographic signature for message integrity (future)

#### Endpoint Format

Endpoints (`from` and `to` fields) specify message routing:

```json
{
  "mud": "required-mud-name",
  "user": "optional-username",
  "displayName": "optional-display-name",
  "channel": "optional-channel-name"
}
```

Special routing values:
- `mud: "*"` - Broadcast to all connected MUDs
- `mud: "Gateway"` - Message directed to gateway itself
- `channel: "channel-name"` - Channel-specific routing

#### Metadata Format

```json
{
  "priority": 1-10,
  "ttl": 1-3600,
  "encoding": "utf-8|ascii|...",
  "language": "en|es|fr|...",
  "retry": false
}
```

- **priority**: Message priority (1=highest, 10=lowest, default=5)
- **ttl**: Time-to-live in seconds (default=300)
- **encoding**: Text encoding (default="utf-8")
- **language**: ISO language code (default="en")
- **retry**: Whether message should be retried on failure

## Transport Layer

OpenIMC supports multiple transport mechanisms:

### Primary: WebSocket over TLS

- **Port**: Configurable (default 8081)
- **Protocol**: `wss://` for production, `ws://` for development
- **Features**: Real-time bidirectional communication, automatic reconnection
- **Use Case**: Primary transport for MUD servers

### Secondary: HTTP/REST API

- **Port**: Configurable (default 8080)
- **Protocol**: `https://` for production, `http://` for development  
- **Features**: Request/response, easier debugging, polling support
- **Use Case**: Simple integrations, debugging, administrative tasks

### Future: QUIC

- **Protocol**: QUIC over UDP
- **Features**: Lower latency, built-in encryption
- **Use Case**: High-performance scenarios

## Authentication

OpenIMC uses a two-tier authentication system:

### 1. MUD Registration

MUDs must register with a gateway to receive an API key:

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "mudName": "UniqueMUDName",
  "adminSecret": "optional-admin-secret"
}
```

Response:
```json
{
  "apiKey": "generated-api-key",
  "mudName": "UniqueMUDName"
}
```

### 2. Session Authentication

#### Option A: WebSocket Authentication

Send auth message after WebSocket connection:

```json
{
  "version": "1.0",
  "id": "auth-message-id",
  "timestamp": "2025-01-08T12:00:00Z",
  "type": "auth",
  "from": {"mud": "YourMUDName"},
  "to": {"mud": "Gateway"},
  "payload": {
    "mudName": "YourMUDName",
    "token": "your-api-key"
  },
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8",
    "language": "en"
  }
}
```

#### Option B: JWT Token (REST API)

Exchange API key for JWT token:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "mudName": "YourMUDName", 
  "apiKey": "your-api-key"
}
```

Use JWT in subsequent requests:
```http
Authorization: Bearer jwt-token-here
```

#### Option C: Direct API Key (REST API)

Include API key in headers:
```http
X-API-Key: your-api-key
X-MUD-Name: YourMUDName
```

## Message Types

### Core Message Types

#### tell
Direct message between users on different MUDs.

```json
{
  "type": "tell",
  "from": {"mud": "SenderMUD", "user": "sender"},
  "to": {"mud": "TargetMUD", "user": "recipient"},
  "payload": {
    "message": "Hello, how are you?",
    "formatted": "Optional pre-formatted version"
  }
}
```

#### emote
Emote action visible to users in the same area.

```json
{
  "type": "emote", 
  "from": {"mud": "SenderMUD", "user": "sender"},
  "to": {"mud": "TargetMUD"},
  "payload": {
    "action": "waves hello",
    "formatted": "Sender waves hello"
  }
}
```

#### emoteto
Emote directed at a specific user.

```json
{
  "type": "emoteto",
  "from": {"mud": "SenderMUD", "user": "sender"}, 
  "to": {"mud": "TargetMUD", "user": "target"},
  "payload": {
    "action": "waves at",
    "target": "target",
    "formatted": "Sender waves at target"
  }
}
```

#### channel
Multi-MUD chat channel communication.

```json
{
  "type": "channel",
  "from": {"mud": "SenderMUD", "user": "sender"},
  "to": {"mud": "*", "channel": "gossip"},
  "payload": {
    "channel": "gossip",
    "message": "Hello everyone!",
    "action": "message",
    "formatted": "[gossip] sender@SenderMUD: Hello everyone!"
  }
}
```

Channel actions:
- `message`: Regular channel message
- `join`: User joining channel
- `leave`: User leaving channel
- `list`: Request channel member list

#### who
Request/response for online user list.

Request:
```json
{
  "type": "who",
  "from": {"mud": "RequestingMUD"},
  "to": {"mud": "TargetMUD"},
  "payload": {
    "request": true
  }
}
```

Response:
```json
{
  "type": "who",
  "from": {"mud": "TargetMUD"},
  "to": {"mud": "RequestingMUD"},
  "payload": {
    "request": false,
    "users": [
      {
        "username": "player1",
        "displayName": "Player One",
        "idleTime": 300,
        "location": "Town Square",
        "level": 25,
        "race": "Human",
        "class": "Warrior"
      }
    ]
  }
}
```

#### finger
Request/response for detailed user information.

Request:
```json
{
  "type": "finger",
  "from": {"mud": "RequestingMUD"},
  "to": {"mud": "TargetMUD", "user": "targetuser"},
  "payload": {
    "user": "targetuser",
    "request": true
  }
}
```

Response:
```json
{
  "type": "finger",
  "from": {"mud": "TargetMUD"},
  "to": {"mud": "RequestingMUD"},
  "payload": {
    "user": "targetuser",
    "request": false,
    "info": {
      "username": "targetuser",
      "displayName": "Target User",
      "realName": "John Doe",
      "email": "user@example.com",
      "lastLogin": "2025-01-08T10:00:00Z",
      "idleTime": 1800,
      "location": "The Library",
      "level": 30,
      "race": "Elf",
      "class": "Mage",
      "guild": "Wizards",
      "plan": "Working on spell research"
    }
  }
}
```

#### locate
Find user across all connected MUDs.

Request:
```json
{
  "type": "locate",
  "from": {"mud": "RequestingMUD"},
  "to": {"mud": "*"},
  "payload": {
    "user": "targetuser",
    "request": true
  }
}
```

Response:
```json
{
  "type": "locate", 
  "from": {"mud": "FoundMUD"},
  "to": {"mud": "RequestingMUD"},
  "payload": {
    "user": "targetuser",
    "request": false,
    "locations": [
      {
        "mud": "FoundMUD",
        "room": "Town Square",
        "area": "Capital City",
        "online": true
      }
    ]
  }
}
```

### System Message Types

#### auth
Authentication message (see [Authentication](#authentication)).

#### ping
Heartbeat ping to maintain connection.

```json
{
  "type": "ping",
  "from": {"mud": "SenderMUD"},
  "to": {"mud": "Gateway"},
  "payload": {
    "timestamp": 1641646800000
  }
}
```

#### pong
Heartbeat pong response.

```json
{
  "type": "pong",
  "from": {"mud": "Gateway"},
  "to": {"mud": "SenderMUD"},
  "payload": {
    "timestamp": 1641646800000
  }
}
```

#### error
Error message for failed operations.

```json
{
  "type": "error",
  "from": {"mud": "Gateway"},
  "to": {"mud": "SenderMUD"},
  "payload": {
    "code": 1001,
    "message": "Authentication failed",
    "details": {
      "reason": "Invalid API key"
    }
  }
}
```

### Advanced Message Types

#### presence
User presence and status updates.

```json
{
  "type": "presence",
  "from": {"mud": "SenderMUD", "user": "username"},
  "to": {"mud": "Gateway"},
  "payload": {
    "status": "online",
    "activity": "Fighting dragons",
    "location": "Dragon's Lair"
  }
}
```

Status values: `online`, `offline`, `away`, `busy`

## Error Handling

### Error Codes

- **1000**: Invalid message format
- **1001**: Authentication failed  
- **1002**: Unauthorized access
- **1003**: MUD not found
- **1004**: User not found
- **1005**: Channel not found
- **1006**: Rate limited
- **1007**: Internal server error
- **1008**: Protocol error
- **1009**: Unsupported version
- **1010**: Message too large

### Error Response Format

```json
{
  "type": "error",
  "from": {"mud": "Gateway"},
  "to": {"mud": "ErroringMUD"},
  "payload": {
    "code": 1001,
    "message": "Human readable error message",
    "details": {
      "originalMessageId": "failed-message-uuid",
      "field": "specific-field-with-error"
    }
  }
}
```

### Retry Logic

Messages with `metadata.retry: true` may be retried:
- Maximum retries based on priority (priority/2)
- Exponential backoff: 2^attempt seconds
- Stop retrying if TTL exceeded

## Security

### Transport Security

- **TLS 1.3**: Required for production deployments
- **Certificate Validation**: Proper certificate chain validation
- **HSTS**: HTTP Strict Transport Security headers

### Message Security

- **Rate Limiting**: Per-connection and per-MUD rate limits
- **Message Validation**: JSON schema validation for all messages
- **Size Limits**: Maximum message size limits (64KB default)
- **TTL Enforcement**: Automatic expiry of old messages

### Authentication Security

- **API Key Rotation**: Regular API key rotation recommended
- **JWT Expiration**: Short-lived JWT tokens (default 7 days)
- **Session Management**: Active session tracking and revocation

### Future Security Features

- **Message Signing**: Cryptographic signatures for message integrity
- **End-to-End Encryption**: Optional E2E encryption for sensitive messages
- **Reputation System**: Trust scores for MUDs and users

## Extension Mechanism

OpenIMC supports extensions through:

### Custom Message Types

Define new message types with `x-` prefix:

```json
{
  "type": "x-auction",
  "payload": {
    "item": "Sword of Awesomeness",
    "startingBid": 1000,
    "duration": 3600
  }
}
```

### Custom Payload Fields

Add custom fields to existing message types:

```json
{
  "type": "tell",
  "payload": {
    "message": "Hello!",
    "x-emotion": "happy",
    "x-priority": "urgent"
  }
}
```

### Plugin Architecture

Gateways can load plugins for:
- Custom message processing
- Additional transport protocols
- Integration with external systems
- Enhanced security features

## Protocol Versioning

### Version Negotiation

Clients specify supported versions in auth message:

```json
{
  "type": "auth",
  "payload": {
    "supportedVersions": ["1.0", "1.1"]
  }
}
```

Gateway responds with selected version:

```json
{
  "type": "auth_response",
  "payload": {
    "version": "1.0",
    "features": ["channels", "presence", "locate"]
  }
}
```

### Backward Compatibility

- Minor version changes maintain compatibility
- Major version changes may break compatibility
- Legacy bridges available for IMC2/IMC3

### Future Versions

Planned features for future versions:
- Media sharing (images, audio, video)
- File transfers
- Voice/video calls
- Enhanced encryption
- Blockchain integration
- AI-powered features

## Implementation Guidelines

### Client Implementation

1. **Connection Management**
   - Implement automatic reconnection
   - Handle connection failures gracefully
   - Use exponential backoff for retries

2. **Message Processing**
   - Validate all incoming messages
   - Handle unknown message types gracefully
   - Implement proper error handling

3. **State Management**
   - Track connection state
   - Maintain user/channel state
   - Handle state synchronization

### Gateway Implementation

1. **Scalability**
   - Support thousands of concurrent connections
   - Implement proper connection pooling
   - Use efficient message routing

2. **Reliability**
   - Handle partial failures gracefully
   - Implement proper logging
   - Monitor system health

3. **Security**
   - Validate all inputs
   - Implement rate limiting
   - Use secure defaults

## Compliance Testing

Implementations should pass the OpenIMC compliance test suite covering:

- Message format validation
- Authentication flows
- Error handling
- Rate limiting
- Security requirements

Test suite available at: https://github.com/Coffee-Nerd/OpenIMC/tests

---

**OpenIMC Protocol Specification v1.0**  
**Last Updated**: January 8, 2025  
**Maintainer**: OpenIMC Development Team  
**License**: MIT