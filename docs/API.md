# OpenIMC API Reference

This document provides a comprehensive reference for the OpenIMC REST API and WebSocket interface.

## Table of Contents

- [Authentication](#authentication)
- [REST API Endpoints](#rest-api-endpoints)
- [WebSocket Protocol](#websocket-protocol)
- [Message Format](#message-format)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)

## Authentication

OpenIMC supports two authentication methods:

### 1. API Key Authentication

Use API key in headers for server-to-server communication:

```http
X-API-Key: your-api-key-here
X-MUD-Name: YourMUDName
```

### 2. JWT Token Authentication

Use JWT tokens for session-based authentication:

```http
Authorization: Bearer your-jwt-token-here
```

## REST API Endpoints

Base URL: `http://localhost:8080/api/v1`

### Authentication Endpoints

#### Register MUD
```http
POST /auth/register
Content-Type: application/json

{
  "mudName": "YourMUDName",
  "adminSecret": "optional-admin-secret"
}
```

**Response:**
```json
{
  "message": "MUD registered successfully",
  "mudName": "YourMUDName",
  "apiKey": "generated-api-key",
  "warning": "Store this API key securely. It cannot be recovered."
}
```

#### Login with API Key
```http
POST /auth/login
Content-Type: application/json

{
  "mudName": "YourMUDName",
  "apiKey": "your-api-key"
}
```

**Response:**
```json
{
  "message": "Authentication successful",
  "token": "jwt-token",
  "mudName": "YourMUDName",
  "expiresIn": "7d"
}
```

#### Logout
```http
POST /auth/logout
Authorization: Bearer jwt-token
```

### Message Endpoints

#### Send Message
```http
POST /messages/send
Authorization: Bearer jwt-token
Content-Type: application/json

{
  "version": "1.0",
  "type": "tell",
  "to": {
    "mud": "TargetMUD",
    "user": "targetuser"
  },
  "payload": {
    "message": "Hello, world!"
  }
}
```

#### Get Message History
```http
GET /messages/history/{type}?limit=50&offset=0
Authorization: Bearer jwt-token
```

### Tell Endpoints

#### Send Tell
```http
POST /tell
Authorization: Bearer jwt-token
Content-Type: application/json

{
  "to": {
    "mud": "TargetMUD",
    "user": "targetuser"
  },
  "message": "Hello!",
  "from": {
    "user": "sender"
  }
}
```

### Channel Endpoints

#### List Channels
```http
GET /channels
Authorization: Bearer jwt-token
```

#### Join Channel
```http
POST /channels/{name}/join
Authorization: Bearer jwt-token
Content-Type: application/json

{
  "user": {
    "username": "player1",
    "displayName": "Player One"
  }
}
```

#### Leave Channel
```http
POST /channels/{name}/leave
Authorization: Bearer jwt-token
Content-Type: application/json

{
  "user": {
    "username": "player1"
  }
}
```

#### Send Channel Message
```http
POST /channels/{name}/message
Authorization: Bearer jwt-token
Content-Type: application/json

{
  "user": {
    "username": "player1"
  },
  "message": "Hello channel!"
}
```

#### Get Channel History
```http
GET /channels/{name}/history?limit=50
Authorization: Bearer jwt-token
```

#### Get Channel Members
```http
GET /channels/{name}/members
Authorization: Bearer jwt-token
```

### User Endpoints

#### Get Online Users
```http
GET /users/online?mud=SpecificMUD
Authorization: Bearer jwt-token
```

#### Locate User
```http
GET /users/locate/{username}
Authorization: Bearer jwt-token
```

#### Search Users
```http
GET /users/search?q=searchterm&limit=10
Authorization: Bearer jwt-token
```

### MUD Management Endpoints

#### List MUDs
```http
GET /muds
Authorization: Bearer jwt-token
```

#### Get Who List
```http
POST /muds/{name}/who
Authorization: Bearer jwt-token
```

### Statistics Endpoint

#### Get Statistics
```http
GET /stats
Authorization: Bearer jwt-token
```

**Response:**
```json
{
  "users": {
    "totalUsers": 150,
    "mudCounts": {
      "MUD1": 50,
      "MUD2": 100
    }
  },
  "muds": {
    "total": 2,
    "connected": 2
  },
  "channels": {
    "active": 5
  },
  "sessions": {
    "active": 2
  },
  "timestamp": "2025-01-08T12:00:00.000Z"
}
```

### Health Check

#### Health Status
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-08T12:00:00.000Z",
  "version": "1.0.0",
  "redis": true
}
```

## WebSocket Protocol

Connect to: `ws://localhost:8081`

### Connection Flow

1. **Connect** to WebSocket endpoint
2. **Authenticate** by sending auth message
3. **Send/Receive** messages in real-time

### Authentication Message
```json
{
  "version": "1.0",
  "id": "uuid",
  "timestamp": "2025-01-08T12:00:00Z",
  "type": "auth",
  "from": {
    "mud": "YourMUDName"
  },
  "to": {
    "mud": "Gateway"
  },
  "payload": {
    "mudName": "YourMUDName",
    "token": "optional-api-key"
  },
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8",
    "language": "en"
  }
}
```

## Message Format

All messages follow the OpenIMC message format:

```json
{
  "version": "1.0",
  "id": "uuid-v4",
  "timestamp": "ISO-8601-timestamp",
  "type": "message-type",
  "from": {
    "mud": "SenderMUD",
    "user": "username",
    "displayName": "Display Name"
  },
  "to": {
    "mud": "TargetMUD",
    "user": "targetuser",
    "channel": "channel-name"
  },
  "payload": {
    // Type-specific content
  },
  "signature": "optional-crypto-signature",
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8",
    "language": "en"
  }
}
```

### Message Types

- `tell` - Direct message between users
- `emote` - Emote action
- `emoteto` - Emote directed at specific user
- `channel` - Channel message
- `who` - Request/response for user list
- `finger` - Request/response for user info
- `locate` - Request/response for user location
- `presence` - User presence update
- `auth` - Authentication message
- `ping` - Heartbeat ping
- `pong` - Heartbeat pong response
- `error` - Error message

### Payload Examples

#### Tell Payload
```json
{
  "message": "Hello, how are you?",
  "formatted": "Optional formatted version"
}
```

#### Channel Payload
```json
{
  "channel": "gossip",
  "message": "Hello everyone!",
  "action": "message",
  "formatted": "Optional formatted version"
}
```

#### Who Payload
```json
{
  "users": [
    {
      "username": "player1",
      "displayName": "Player One",
      "idleTime": 300,
      "location": "Town Square"
    }
  ],
  "request": false
}
```

## Error Handling

### Error Response Format
```json
{
  "error": "Error Type",
  "message": "Human readable error message",
  "code": 1001,
  "timestamp": "2025-01-08T12:00:00.000Z"
}
```

### Error Codes

- `1000` - Invalid message format
- `1001` - Authentication failed
- `1002` - Unauthorized access
- `1003` - MUD not found
- `1004` - User not found
- `1005` - Channel not found
- `1006` - Rate limited
- `1007` - Internal server error
- `1008` - Protocol error
- `1009` - Unsupported version
- `1010` - Message too large

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Rate Limiting

Rate limits are applied per endpoint and authentication method:

### Limits

- **API endpoints**: 100 requests/minute
- **Authentication**: 5 attempts/5 minutes
- **MUD operations**: 200 requests/minute
- **WebSocket connections**: 10/minute per IP
- **Messages**: 100/minute per MUD
- **Channel messages**: 50/minute per MUD
- **Tell messages**: 30/minute per MUD

### Rate Limit Headers

Responses include rate limiting information:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2025-01-08T12:01:00.000Z
Retry-After: 60
```

### Rate Limit Response

When rate limited:

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for api",
  "retryAfter": 60
}
```

## Example Client Implementation

### Node.js with OpenIMC Client
```javascript
const { OpenIMCClient } = require('openimc');

const client = new OpenIMCClient({
  mudName: 'MyMUD',
  autoReconnect: true
});

// Connect and authenticate
await client.connect('ws://localhost:8081', 'your-api-key');

// Handle incoming tells
client.onTell((message) => {
  console.log(`Tell from ${message.from.user}@${message.from.mud}: ${message.payload.message}`);
});

// Send a tell
client.sendTell(
  { mud: 'OtherMUD', user: 'player1' },
  'Hello from MyMUD!'
);

// Join a channel
client.joinChannel('gossip', 'player1');

// Send channel message
client.sendChannelMessage('gossip', 'Hello channel!', 'player1');
```

### Python Example
```python
import asyncio
import json
import websockets

async def openimc_client():
    uri = "ws://localhost:8081"
    
    async with websockets.connect(uri) as websocket:
        # Authenticate
        auth_msg = {
            "version": "1.0",
            "id": "unique-id",
            "timestamp": "2025-01-08T12:00:00Z",
            "type": "auth",
            "from": {"mud": "MyMUD"},
            "to": {"mud": "Gateway"},
            "payload": {"mudName": "MyMUD"},
            "metadata": {
                "priority": 5,
                "ttl": 300,
                "encoding": "utf-8",
                "language": "en"
            }
        }
        
        await websocket.send(json.dumps(auth_msg))
        
        # Listen for messages
        async for message in websocket:
            data = json.loads(message)
            print(f"Received: {data['type']} from {data['from']['mud']}")

asyncio.run(openimc_client())
```

For more examples and detailed integration guides, see the [Integration Guide](INTEGRATION.md).