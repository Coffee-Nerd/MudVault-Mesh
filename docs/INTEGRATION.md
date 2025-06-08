# OpenIMC Integration Guide

This guide walks you through integrating OpenIMC with your MUD server, regardless of the programming language or MUD codebase you're using.

## Table of Contents

- [Quick Start](#quick-start)
- [Integration Options](#integration-options)
- [Language-Specific Examples](#language-specific-examples)
- [Common Patterns](#common-patterns)
- [Testing Your Integration](#testing-your-integration)
- [Troubleshooting](#troubleshooting)

## Quick Start

### 1. Set Up OpenIMC Gateway

The easiest way to get started is with Docker:

```bash
# Clone the repository
git clone https://github.com/Coffee-Nerd/OpenIMC.git
cd OpenIMC

# Start with Docker Compose
docker-compose up -d

# Or build and run manually
npm install
npm run build
npm start
```

The gateway will be available at:
- HTTP API: `http://localhost:8080`
- WebSocket: `ws://localhost:8081`

### 2. Register Your MUD

```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "mudName": "YourMUDName"
  }'
```

Save the returned API key securely!

### 3. Test Connection

```bash
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "mudName": "YourMUDName",
    "apiKey": "your-api-key-here"
  }'
```

## Integration Options

You can integrate OpenIMC in several ways, depending on your MUD's architecture:

### Option 1: Direct WebSocket Integration (Recommended)

Connect directly to the OpenIMC WebSocket for real-time bidirectional communication.

**Pros:**
- Real-time message delivery
- Automatic reconnection support
- Lower latency
- Full protocol support

**Cons:**
- Requires WebSocket client implementation
- More complex than REST API

### Option 2: REST API Integration

Use HTTP requests to send messages and poll for incoming messages.

**Pros:**
- Simple HTTP requests
- Works with any HTTP client
- Easy to debug and test

**Cons:**
- Not real-time (polling required)
- Higher latency
- More bandwidth usage

### Option 3: Hybrid Approach

Use WebSocket for receiving messages and REST API for sending.

**Pros:**
- Real-time incoming messages
- Simple outgoing message sending
- Good balance of complexity and features

**Cons:**
- Requires both WebSocket and HTTP implementations

## Language-Specific Examples

### Node.js / JavaScript

#### Using the OpenIMC Client Library

```javascript
const { OpenIMCClient } = require('./src/clients');

class MUDIntegration {
  constructor(mudName, apiKey) {
    this.client = new OpenIMCClient({
      mudName: mudName,
      autoReconnect: true,
      heartbeatInterval: 30000
    });
    
    this.apiKey = apiKey;
    this.setupEventHandlers();
  }

  async connect() {
    try {
      await this.client.connect('ws://localhost:8081', this.apiKey);
      console.log('Connected to OpenIMC');
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  }

  setupEventHandlers() {
    // Handle incoming tells
    this.client.onTell((message) => {
      this.handleIncomingTell(message);
    });

    // Handle channel messages
    this.client.onChannel((message) => {
      this.handleChannelMessage(message);
    });

    // Handle who requests
    this.client.onWho((message) => {
      if (message.payload.request) {
        this.handleWhoRequest(message);
      } else {
        this.handleWhoResponse(message);
      }
    });

    // Handle connection events
    this.client.on('connected', () => {
      console.log('OpenIMC connected');
    });

    this.client.on('disconnected', ({ code, reason }) => {
      console.log(`OpenIMC disconnected: ${code} ${reason}`);
    });

    this.client.on('error', (error) => {
      console.error('OpenIMC error:', error);
    });
  }

  handleIncomingTell(message) {
    const from = `${message.from.user}@${message.from.mud}`;
    const to = message.to.user;
    const text = message.payload.message;

    // Forward to your MUD's tell system
    this.sendToPlayer(to, `${from} tells you: ${text}`);
  }

  handleChannelMessage(message) {
    const channel = message.payload.channel;
    const from = `${message.from.user}@${message.from.mud}`;
    const text = message.payload.message;

    // Forward to players listening to this channel
    this.broadcastToChannel(channel, `[${channel}] ${from}: ${text}`);
  }

  handleWhoRequest(message) {
    const users = this.getOnlineUsers(); // Your MUD's user list
    const response = users.map(user => ({
      username: user.name,
      displayName: user.displayName,
      idleTime: user.idleTime,
      location: user.location,
      level: user.level
    }));

    // Send who response back
    this.client.sendMessage('who', message.from, {
      users: response,
      request: false
    });
  }

  // Your MUD interface methods
  sendToPlayer(username, message) {
    // Implement: Send message to specific player in your MUD
  }

  broadcastToChannel(channel, message) {
    // Implement: Broadcast to players listening to channel
  }

  getOnlineUsers() {
    // Implement: Return list of online users
    return [];
  }

  // Public methods for your MUD to call
  sendTell(fromUser, toMud, toUser, message) {
    this.client.sendTell(
      { mud: toMud, user: toUser },
      message
    );
  }

  sendChannelMessage(channel, user, message) {
    this.client.sendChannelMessage(channel, message, user);
  }

  joinChannel(channel, user) {
    this.client.joinChannel(channel, user);
  }

  leaveChannel(channel, user) {
    this.client.leaveChannel(channel, user);
  }
}

// Usage
const integration = new MUDIntegration('MyMUD', 'your-api-key');
integration.connect();
```

### Python

```python
import asyncio
import json
import websockets
import aiohttp
from typing import Dict, Any, List

class OpenIMCIntegration:
    def __init__(self, mud_name: str, api_key: str):
        self.mud_name = mud_name
        self.api_key = api_key
        self.websocket = None
        self.running = False

    async def connect(self):
        """Connect to OpenIMC gateway"""
        try:
            self.websocket = await websockets.connect('ws://localhost:8081')
            await self.authenticate()
            self.running = True
            
            # Start message handler
            asyncio.create_task(self.message_handler())
            print(f"Connected to OpenIMC as {self.mud_name}")
            
        except Exception as e:
            print(f"Failed to connect: {e}")

    async def authenticate(self):
        """Send authentication message"""
        auth_message = {
            "version": "1.0",
            "id": self.generate_id(),
            "timestamp": self.get_timestamp(),
            "type": "auth",
            "from": {"mud": self.mud_name},
            "to": {"mud": "Gateway"},
            "payload": {
                "mudName": self.mud_name,
                "token": self.api_key
            },
            "metadata": {
                "priority": 5,
                "ttl": 300,
                "encoding": "utf-8",
                "language": "en"
            }
        }
        
        await self.websocket.send(json.dumps(auth_message))

    async def message_handler(self):
        """Handle incoming messages"""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                await self.process_message(data)
        except websockets.exceptions.ConnectionClosed:
            print("Connection closed")
            self.running = False

    async def process_message(self, message: Dict[str, Any]):
        """Process incoming OpenIMC message"""
        msg_type = message.get('type')
        
        if msg_type == 'tell':
            await self.handle_tell(message)
        elif msg_type == 'channel':
            await self.handle_channel_message(message)
        elif msg_type == 'who':
            await self.handle_who_request(message)
        elif msg_type == 'ping':
            await self.handle_ping(message)
        elif msg_type == 'error':
            print(f"Error: {message['payload']['message']}")

    async def handle_tell(self, message: Dict[str, Any]):
        """Handle incoming tell message"""
        from_user = f"{message['from']['user']}@{message['from']['mud']}"
        to_user = message['to']['user']
        text = message['payload']['message']
        
        # Send to your MUD's player
        await self.send_to_player(to_user, f"{from_user} tells you: {text}")

    async def handle_channel_message(self, message: Dict[str, Any]):
        """Handle channel message"""
        channel = message['payload']['channel']
        from_user = f"{message['from']['user']}@{message['from']['mud']}"
        text = message['payload']['message']
        
        # Broadcast to channel listeners
        await self.broadcast_to_channel(channel, f"[{channel}] {from_user}: {text}")

    async def handle_who_request(self, message: Dict[str, Any]):
        """Handle who request"""
        if message['payload'].get('request'):
            users = await self.get_online_users()
            response = {
                "version": "1.0",
                "id": self.generate_id(),
                "timestamp": self.get_timestamp(),
                "type": "who",
                "from": {"mud": self.mud_name},
                "to": message['from'],
                "payload": {
                    "users": users,
                    "request": False
                },
                "metadata": {
                    "priority": 5,
                    "ttl": 300,
                    "encoding": "utf-8",
                    "language": "en"
                }
            }
            
            await self.websocket.send(json.dumps(response))

    async def handle_ping(self, message: Dict[str, Any]):
        """Handle ping message"""
        pong = {
            "version": "1.0",
            "id": self.generate_id(),
            "timestamp": self.get_timestamp(),
            "type": "pong",
            "from": {"mud": self.mud_name},
            "to": {"mud": "Gateway"},
            "payload": {
                "timestamp": message['payload']['timestamp']
            },
            "metadata": {
                "priority": 5,
                "ttl": 300,
                "encoding": "utf-8",
                "language": "en"
            }
        }
        
        await self.websocket.send(json.dumps(pong))

    # Public interface methods
    async def send_tell(self, from_user: str, to_mud: str, to_user: str, message: str):
        """Send a tell message"""
        tell_msg = {
            "version": "1.0",
            "id": self.generate_id(),
            "timestamp": self.get_timestamp(),
            "type": "tell",
            "from": {"mud": self.mud_name, "user": from_user},
            "to": {"mud": to_mud, "user": to_user},
            "payload": {"message": message},
            "metadata": {
                "priority": 5,
                "ttl": 300,
                "encoding": "utf-8",
                "language": "en"
            }
        }
        
        await self.websocket.send(json.dumps(tell_msg))

    async def send_channel_message(self, channel: str, user: str, message: str):
        """Send a channel message"""
        channel_msg = {
            "version": "1.0",
            "id": self.generate_id(),
            "timestamp": self.get_timestamp(),
            "type": "channel",
            "from": {"mud": self.mud_name, "user": user},
            "to": {"mud": "*", "channel": channel},
            "payload": {
                "channel": channel,
                "message": message,
                "action": "message"
            },
            "metadata": {
                "priority": 5,
                "ttl": 300,
                "encoding": "utf-8",
                "language": "en"
            }
        }
        
        await self.websocket.send(json.dumps(channel_msg))

    # Implement these methods based on your MUD
    async def send_to_player(self, username: str, message: str):
        """Send message to player in your MUD"""
        pass

    async def broadcast_to_channel(self, channel: str, message: str):
        """Broadcast message to channel listeners"""
        pass

    async def get_online_users(self) -> List[Dict[str, Any]]:
        """Get list of online users"""
        return []

    def generate_id(self) -> str:
        """Generate unique message ID"""
        import uuid
        return str(uuid.uuid4())

    def get_timestamp(self) -> str:
        """Get current timestamp in ISO format"""
        from datetime import datetime
        return datetime.utcnow().isoformat() + 'Z'

# Usage
async def main():
    integration = OpenIMCIntegration('MyMUD', 'your-api-key')
    await integration.connect()
    
    # Keep running
    while integration.running:
        await asyncio.sleep(1)

asyncio.run(main())
```

### C++

```cpp
#include <websocketpp/config/asio_client.hpp>
#include <websocketpp/client.hpp>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <thread>

using json = nlohmann::json;
typedef websocketpp::client<websocketpp::config::asio_tls_client> client;

class OpenIMCIntegration {
private:
    client ws_client;
    websocketpp::connection_hdl connection;
    std::string mud_name;
    std::string api_key;
    bool connected = false;

public:
    OpenIMCIntegration(const std::string& mud_name, const std::string& api_key)
        : mud_name(mud_name), api_key(api_key) {
        
        ws_client.set_access_channels(websocketpp::log::alevel::all);
        ws_client.clear_access_channels(websocketpp::log::alevel::frame_payload);
        ws_client.init_asio();
        
        ws_client.set_message_handler([this](websocketpp::connection_hdl hdl, client::message_ptr msg) {
            handle_message(msg->get_payload());
        });
        
        ws_client.set_open_handler([this](websocketpp::connection_hdl hdl) {
            connected = true;
            authenticate();
        });
    }

    void connect() {
        websocketpp::lib::error_code ec;
        auto con = ws_client.get_connection("ws://localhost:8081", ec);
        
        if (ec) {
            std::cout << "Could not create connection: " << ec.message() << std::endl;
            return;
        }

        connection = con->get_handle();
        ws_client.connect(con);
        
        std::thread([this]() {
            ws_client.run();
        }).detach();
    }

    void authenticate() {
        json auth_msg = {
            {"version", "1.0"},
            {"id", generate_uuid()},
            {"timestamp", get_timestamp()},
            {"type", "auth"},
            {"from", {{"mud", mud_name}}},
            {"to", {{"mud", "Gateway"}}},
            {"payload", {
                {"mudName", mud_name},
                {"token", api_key}
            }},
            {"metadata", {
                {"priority", 5},
                {"ttl", 300},
                {"encoding", "utf-8"},
                {"language", "en"}
            }}
        };
        
        send_message(auth_msg.dump());
    }

    void handle_message(const std::string& message) {
        try {
            json msg = json::parse(message);
            std::string type = msg["type"];
            
            if (type == "tell") {
                handle_tell(msg);
            } else if (type == "channel") {
                handle_channel_message(msg);
            } else if (type == "who") {
                handle_who_request(msg);
            } else if (type == "ping") {
                handle_ping(msg);
            }
        } catch (const std::exception& e) {
            std::cerr << "Error parsing message: " << e.what() << std::endl;
        }
    }

    void handle_tell(const json& message) {
        std::string from = message["from"]["user"].get<std::string>() + "@" + 
                          message["from"]["mud"].get<std::string>();
        std::string to = message["to"]["user"];
        std::string text = message["payload"]["message"];
        
        // Send to your MUD's player
        send_to_player(to, from + " tells you: " + text);
    }

    void handle_channel_message(const json& message) {
        std::string channel = message["payload"]["channel"];
        std::string from = message["from"]["user"].get<std::string>() + "@" + 
                          message["from"]["mud"].get<std::string>();
        std::string text = message["payload"]["message"];
        
        // Broadcast to channel listeners
        broadcast_to_channel(channel, "[" + channel + "] " + from + ": " + text);
    }

    void handle_who_request(const json& message) {
        if (message["payload"]["request"].get<bool>()) {
            auto users = get_online_users();
            
            json response = {
                {"version", "1.0"},
                {"id", generate_uuid()},
                {"timestamp", get_timestamp()},
                {"type", "who"},
                {"from", {{"mud", mud_name}}},
                {"to", message["from"]},
                {"payload", {
                    {"users", users},
                    {"request", false}
                }},
                {"metadata", {
                    {"priority", 5},
                    {"ttl", 300},
                    {"encoding", "utf-8"},
                    {"language", "en"}
                }}
            };
            
            send_message(response.dump());
        }
    }

    void handle_ping(const json& message) {
        json pong = {
            {"version", "1.0"},
            {"id", generate_uuid()},
            {"timestamp", get_timestamp()},
            {"type", "pong"},
            {"from", {{"mud", mud_name}}},
            {"to", {{"mud", "Gateway"}}},
            {"payload", {
                {"timestamp", message["payload"]["timestamp"]}
            }},
            {"metadata", {
                {"priority", 5},
                {"ttl", 300},
                {"encoding", "utf-8"},
                {"language", "en"}
            }}
        };
        
        send_message(pong.dump());
    }

    void send_tell(const std::string& from_user, const std::string& to_mud, 
                   const std::string& to_user, const std::string& message) {
        json tell_msg = {
            {"version", "1.0"},
            {"id", generate_uuid()},
            {"timestamp", get_timestamp()},
            {"type", "tell"},
            {"from", {{"mud", mud_name}, {"user", from_user}}},
            {"to", {{"mud", to_mud}, {"user", to_user}}},
            {"payload", {{"message", message}}},
            {"metadata", {
                {"priority", 5},
                {"ttl", 300},
                {"encoding", "utf-8"},
                {"language", "en"}
            }}
        };
        
        send_message(tell_msg.dump());
    }

private:
    void send_message(const std::string& message) {
        websocketpp::lib::error_code ec;
        ws_client.send(connection, message, websocketpp::frame::opcode::text, ec);
        
        if (ec) {
            std::cout << "Error sending message: " << ec.message() << std::endl;
        }
    }

    // Implement these based on your MUD
    void send_to_player(const std::string& username, const std::string& message) {
        // Send message to player in your MUD
    }

    void broadcast_to_channel(const std::string& channel, const std::string& message) {
        // Broadcast to channel listeners
    }

    json get_online_users() {
        // Return list of online users
        return json::array();
    }

    std::string generate_uuid() {
        // Generate UUID (use boost::uuid or similar)
        return "uuid-placeholder";
    }

    std::string get_timestamp() {
        // Return ISO timestamp
        return "2025-01-08T12:00:00Z";
    }
};
```

## Common Patterns

### 1. Message Routing

```javascript
class MessageRouter {
  constructor(imcClient, mudInterface) {
    this.imc = imcClient;
    this.mud = mudInterface;
    this.setupRouting();
  }

  setupRouting() {
    // Route incoming tells to MUD tell system
    this.imc.onTell((msg) => {
      this.mud.sendTell(msg.to.user, 
        `${msg.from.user}@${msg.from.mud} tells you: ${msg.payload.message}`);
    });

    // Route outgoing tells to IMC
    this.mud.onTell((fromUser, toUser, message) => {
      const [targetUser, targetMud] = toUser.split('@');
      if (targetMud) {
        this.imc.sendTell({mud: targetMud, user: targetUser}, message);
      }
    });
  }
}
```

### 2. Channel Management

```javascript
class ChannelManager {
  constructor(imcClient) {
    this.imc = imcClient;
    this.channels = new Map();
    this.userChannels = new Map();
  }

  joinChannel(user, channel) {
    if (!this.userChannels.has(user)) {
      this.userChannels.set(user, new Set());
    }
    
    this.userChannels.get(user).add(channel);
    this.imc.joinChannel(channel, user);
  }

  leaveChannel(user, channel) {
    const userChans = this.userChannels.get(user);
    if (userChans) {
      userChans.delete(channel);
      this.imc.leaveChannel(channel, user);
    }
  }

  sendChannelMessage(user, channel, message) {
    if (this.userChannels.get(user)?.has(channel)) {
      this.imc.sendChannelMessage(channel, message, user);
    }
  }
}
```

### 3. User Presence Tracking

```javascript
class PresenceManager {
  constructor(imcClient) {
    this.imc = imcClient;
    this.onlineUsers = new Map();
  }

  userLogin(userInfo) {
    this.onlineUsers.set(userInfo.username, userInfo);
    this.imc.setUserOnline(userInfo);
  }

  userLogout(username) {
    this.onlineUsers.delete(username);
    this.imc.setUserOffline(username);
  }

  updateUserLocation(username, location) {
    const user = this.onlineUsers.get(username);
    if (user) {
      user.location = location;
      this.imc.setUserOnline(user);
    }
  }
}
```

## Testing Your Integration

### 1. Unit Tests

Test individual components:

```javascript
// Test message handling
describe('OpenIMC Integration', () => {
  it('should handle incoming tells', async () => {
    const integration = new MUDIntegration('TestMUD', 'test-key');
    const mockMessage = {
      type: 'tell',
      from: { mud: 'OtherMUD', user: 'player1' },
      to: { mud: 'TestMUD', user: 'player2' },
      payload: { message: 'Hello!' }
    };

    integration.handleIncomingTell(mockMessage);
    
    // Verify message was forwarded to player2
    expect(mockMUD.getPlayerMessage('player2')).toContain('player1@OtherMUD tells you: Hello!');
  });
});
```

### 2. Integration Tests

Test with a running OpenIMC gateway:

```bash
# Start test gateway
docker run -d -p 8080:8080 -p 8081:8081 --name test-openimc openimc/gateway:latest

# Register test MUD
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"mudName": "TestMUD"}'

# Test WebSocket connection
node test-websocket.js
```

### 3. Load Testing

Test performance under load:

```javascript
const { OpenIMCClient } = require('openimc');

async function loadTest() {
  const clients = [];
  
  // Create 100 concurrent connections
  for (let i = 0; i < 100; i++) {
    const client = new OpenIMCClient({ mudName: `TestMUD${i}` });
    await client.connect('ws://localhost:8081');
    clients.push(client);
  }

  // Send messages rapidly
  for (let i = 0; i < 1000; i++) {
    const client = clients[i % clients.length];
    client.sendTell({ mud: 'OtherMUD', user: 'player1' }, `Message ${i}`);
    
    if (i % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Connection Refused**
   - Check if OpenIMC gateway is running
   - Verify port accessibility
   - Check firewall settings

2. **Authentication Failed**
   - Verify API key is correct
   - Check MUD name matches registration
   - Ensure proper message format

3. **Messages Not Received**
   - Check WebSocket connection status
   - Verify message routing configuration
   - Check rate limiting

4. **High Latency**
   - Check network connectivity
   - Verify Redis is running properly
   - Monitor gateway performance

### Debugging

Enable debug logging:

```javascript
// Node.js
process.env.LOG_LEVEL = 'debug';

// Python
import logging
logging.basicConfig(level=logging.DEBUG)
```

Use WebSocket debugging tools:
- Browser developer tools
- Wireshark for packet analysis
- OpenIMC gateway logs

### Performance Optimization

1. **Connection Pooling**
   - Reuse WebSocket connections
   - Implement connection pooling for HTTP requests

2. **Message Batching**
   - Batch multiple messages when possible
   - Use priority-based message queuing

3. **Caching**
   - Cache frequently accessed data
   - Implement local user/channel caches

4. **Compression**
   - Enable WebSocket compression
   - Compress large payloads

For more troubleshooting help, see the [Troubleshooting Guide](TROUBLESHOOTING.md) or join our [Discord community](https://discord.gg/r6kM56YrEV).