# MudVault Mesh - Node.js Client

Connect your Node.js MUD to the MudVault Mesh network for seamless inter-MUD communication.

## Installation

```bash
npm install mudvault-mesh
```

## Quick Start

```javascript
const { MeshClient } = require('mudvault-mesh');

// Create client
const client = new MeshClient('YourMUDName');

// Handle incoming tells
client.onTell((message) => {
  console.log(`${message.from.user}@${message.from.mud} tells you: ${message.payload.message}`);
  // Forward to your MUD's tell system
});

// Handle channel messages
client.onChannel((message) => {
  if (message.payload.action === 'message') {
    console.log(`[${message.payload.channel}] ${message.from.user}@${message.from.mud}: ${message.payload.message}`);
    // Forward to your MUD's channel system
  }
});

// Connect to MudVault Mesh
async function start() {
  try {
    await client.connect(); // Defaults to wss://mesh.mudvault.org
    console.log('Connected to MudVault Mesh!');
    
    // Join a channel
    client.joinChannel('gossip', 'SystemBot');
    
    // Send a message
    client.sendChannelMessage('gossip', 'Hello from our MUD!', 'SystemBot');
    
  } catch (error) {
    console.error('Failed to connect:', error);
  }
}

start();
```

## API Reference

### MeshClient

#### Constructor

```javascript
const client = new MeshClient(options);
```

**Options:**
- `mudName` (string, required): Your MUD's unique name
- `autoReconnect` (boolean, default: true): Auto-reconnect on disconnect
- `reconnectInterval` (number, default: 5000): Base reconnection delay in ms
- `maxReconnectAttempts` (number, default: 10): Maximum reconnection attempts
- `heartbeatInterval` (number, default: 30000): Heartbeat interval in ms
- `timeout` (number, default: 10000): Connection timeout in ms

#### Methods

##### Connection
- `connect(gatewayUrl?, apiKey?)` - Connect to mesh gateway
- `disconnect()` - Disconnect from gateway
- `isConnected()` - Check connection status
- `isAuthenticated()` - Check authentication status

##### Messaging
- `sendTell(to, message)` - Send private message
- `sendChannelMessage(channel, message, user?)` - Send channel message
- `joinChannel(channel, user?)` - Join a channel
- `leaveChannel(channel, user?)` - Leave a channel

##### Information
- `requestWho(targetMud)` - Request who list from MUD
- `requestFinger(targetMud, targetUser)` - Request user info
- `requestLocate(targetUser)` - Find user across all MUDs

##### Presence
- `setUserOnline(userInfo)` - Mark user as online
- `setUserOffline(username)` - Mark user as offline

#### Events

```javascript
// Connection events
client.on('connected', () => {});
client.on('authenticated', () => {});
client.on('disconnected', ({ code, reason }) => {});
client.on('error', (error) => {});

// Message events
client.onTell((message) => {});
client.onChannel((message) => {});
client.onWho((message) => {});
client.onFinger((message) => {});
client.onLocate((message) => {});
client.onEmote((message) => {});
client.onEmoteTo((message) => {});

// Generic message event
client.on('message', (message) => {});
```

## Message Format

All messages follow the MudVault Mesh protocol:

```javascript
{
  "version": "1.0",
  "id": "uuid-v4",
  "timestamp": "2025-01-08T12:00:00.000Z",
  "type": "tell|channel|who|etc",
  "from": {
    "mud": "SenderMUD",
    "user": "username"
  },
  "to": {
    "mud": "TargetMUD", 
    "user": "username",
    "channel": "channelname"
  },
  "payload": {
    // Message-specific data
  },
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8", 
    "language": "en"
  }
}
```

## Examples

### Basic Tell System

```javascript
const { MeshClient } = require('mudvault-mesh');
const client = new MeshClient('MyMUD');

client.onTell(async (message) => {
  const from = `${message.from.user}@${message.from.mud}`;
  const to = message.to.user;
  const text = message.payload.message;
  
  // Send to your MUD's player
  await sendToPlayer(to, `${from} tells you: ${text}`);
});

// Send tell from your MUD
function mudTell(fromUser, toMud, toUser, message) {
  client.sendTell(
    { mud: toMud, user: toUser },
    message
  );
}
```

### Channel Integration

```javascript
client.onChannel((message) => {
  const { channel, action } = message.payload;
  
  switch (action) {
    case 'message':
      const from = `${message.from.user}@${message.from.mud}`;
      broadcastToChannel(channel, `[${channel}] ${from}: ${message.payload.message}`);
      break;
      
    case 'join':
      broadcastToChannel(channel, `${message.from.user}@${message.from.mud} joined ${channel}`);
      break;
      
    case 'leave':
      broadcastToChannel(channel, `${message.from.user}@${message.from.mud} left ${channel}`);
      break;
  }
});

// Channel commands from your MUD
function joinMeshChannel(channel, username) {
  client.joinChannel(channel, username);
}

function sendToMeshChannel(channel, message, username) {
  client.sendChannelMessage(channel, message, username);
}
```

### Who List Integration

```javascript
client.onWho((message) => {
  if (message.payload.users) {
    // Response to who request
    const users = message.payload.users;
    const mudName = message.from.mud;
    
    console.log(`Users online at ${mudName}:`);
    users.forEach(user => {
      console.log(`  ${user.username} - Level ${user.level} ${user.race} ${user.class}`);
    });
  }
});

// Request who list
function checkWhoOnMud(mudName) {
  client.requestWho(mudName);
}
```

## Error Handling

```javascript
client.on('error', (error) => {
  console.error('Mesh client error:', error.message);
});

client.on('reconnecting', ({ attempt }) => {
  console.log(`Reconnecting to mesh... attempt ${attempt}`);
});

client.on('reconnectFailed', ({ attempt, error }) => {
  console.error(`Reconnect attempt ${attempt} failed:`, error.message);
});

client.on('reconnectGiveUp', () => {
  console.error('Max reconnection attempts reached, giving up');
});
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import { MeshClient, MeshMessage, MessageType } from 'mudvault-mesh';

const client = new MeshClient({
  mudName: 'MyMUD',
  autoReconnect: true
});

client.onTell((message: MeshMessage) => {
  // Fully typed message object
  console.log(message.payload.message);
});
```

## License

MIT License - see LICENSE file for details.

## Support

- **Discord**: [Join our community](https://discord.gg/r6kM56YrEV)
- **GitHub**: [Report issues](https://github.com/Coffee-Nerd/OpenIMC/issues)
- **Documentation**: [Full protocol docs](https://github.com/Coffee-Nerd/OpenIMC/docs)