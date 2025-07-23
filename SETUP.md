# MudVault Mesh Setup Guide

This guide covers setting up the complete MudVault ecosystem: the central network hub, connecting your MUD, and Discord integration.

## Architecture Overview

The improved architecture integrates Discord directly into the main MudVault server:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Your MUD      │    │   MudVault Hub   │    │     Discord     │
│                 │◄──►│                  │◄──►│     Server      │
│ (mudlib client) │    │  • Gateway       │    │                 │
│                 │    │  • Redis         │    │                 │
└─────────────────┘    │  • Discord Bot   │    └─────────────────┘
                       │  • API Server    │
┌─────────────────┐    │                  │    ┌─────────────────┐
│   Another MUD   │◄──►│                  │◄──►│   Another MUD   │
│                 │    └──────────────────┘    │                 │
└─────────────────┘                           └─────────────────┘
```

**Benefits of this approach:**
- Single service to manage
- Discord participates as a "virtual MUD" in the network
- Full access to all MudVault features
- Simplified deployment and maintenance

## 1. Setting Up the MudVault Network Hub

### Prerequisites

- Node.js 18+ 
- Redis server
- Discord bot token (if using Discord integration)

### Installation

```bash
# Clone and setup
cd /path/to/your/mudvault
npm install

# Install discord.js if not already present
npm install discord.js@^14.14.1

# Create environment configuration
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Core Server Configuration
PORT=8080                    # HTTP API port
WS_PORT=8081                # WebSocket gateway port
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_very_secure_secret_here
LOG_LEVEL=info

# Security
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=900

# Discord Integration (optional but recommended)
DISCORD_ENABLED=true
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_BRIDGE_CHANNEL_ID=your_channel_id
DISCORD_MUD_NAME=DiscordBridge
DISCORD_CHANNELS=ooc,chat,gossip
DISCORD_REQUIRE_VERIFICATION=true
DISCORD_RATE_LIMIT_MESSAGES=10
DISCORD_RATE_LIMIT_COMMANDS=5
```

### Discord Bot Setup (if enabling Discord)

1. **Create Discord Application:**
   - Go to https://discord.com/developers/applications
   - Click "New Application"
   - Name it "MudVault Bridge" or similar

2. **Create Bot:**
   - Go to "Bot" section
   - Click "Add Bot"
   - Copy the token to your `.env` file
   - Enable "Message Content Intent"

3. **Bot Permissions:**
   - Navigate to "OAuth2" > "URL Generator"
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: 
     - Send Messages
     - Use Slash Commands
     - Embed Links
     - Read Message History
     - Manage Messages (for deleting user messages)

4. **Invite Bot:**
   - Use the generated URL to invite the bot to your Discord server
   - Get your server ID and channel ID (enable Developer Mode in Discord)

### Start the Hub

```bash
# Development mode
npm run dev

# Production mode  
npm run build
npm start

# With Docker
docker-compose up
```

### Verify Setup

The hub should start and show:
```
✅ MudVault Mesh Gateway started successfully!
🌐 HTTP API: http://localhost:8080
🔌 WebSocket: ws://localhost:8081
📖 Documentation: https://github.com/Coffee-Nerd/MudVault-Mesh
```

If Discord is enabled:
```
Discord bot logged in as MudVaultBridge#1234
Discord service connected to MudVault
```

## 2. Connecting Your MUD to MudVault

### For LPC/LPMudlibs (FluffOS, etc.)

Create `/adm/etc/mudvault.c`:

```lpc
// MudVault Mesh Integration for LPC MUDs
// This connects your MUD to the MudVault network

#include <lib.h>
#include <json.h>

#define MUDVAULT_URL "ws://your-mudvault-server:8081"
#define MUD_NAME "YourMudName"
#define API_KEY "your-api-key"  // Optional

private object websocket;
private mapping message_callbacks;
private string connection_id;

void create() {
    message_callbacks = ([]);
    connect_to_mudvault();
}

void connect_to_mudvault() {
    websocket = new("/std/websocket");
    websocket->set_callback(this_object());
    websocket->connect(MUDVAULT_URL);
}

// WebSocket callbacks
void on_open() {
    write_log("MudVault: Connected to network");
    
    // Send authentication message
    mapping auth_msg = ([
        "version": "1.0",
        "id": generate_uuid(),
        "timestamp": time_string(),
        "type": "auth",
        "from": ([ "mud": MUD_NAME ]),
        "to": ([ "mud": "Gateway" ]),
        "payload": ([ "mudName": MUD_NAME, "apiKey": API_KEY ]),
        "metadata": ([ "priority": 10 ])
    ]);
    
    websocket->send(json_encode(auth_msg));
}

void on_message(string data) {
    mapping msg;
    
    if (catch(msg = json_decode(data))) {
        write_log("MudVault: Invalid JSON received");
        return;
    }
    
    switch(msg["type"]) {
        case "tell":
            handle_incoming_tell(msg);
            break;
        case "channel":
            handle_incoming_channel(msg);
            break;
        case "who":
            handle_who_request(msg);
            break;
        case "custom":
            if (msg["payload"]["type"] == "discord_verify") {
                handle_discord_verification(msg["payload"]["code"]);
            }
            break;
    }
}

void on_close() {
    write_log("MudVault: Connection closed, attempting reconnect...");
    call_out("connect_to_mudvault", 5);
}

// Outgoing message functions
void send_tell(string target_mud, string target_user, string message) {
    mapping msg = ([
        "version": "1.0",
        "id": generate_uuid(),
        "timestamp": time_string(),
        "type": "tell",
        "from": ([ "mud": MUD_NAME, "user": this_player()->query_name() ]),
        "to": ([ "mud": target_mud, "user": target_user ]),
        "payload": ([ "message": message ]),
        "metadata": ([ "priority": 5 ])
    ]);
    
    websocket->send(json_encode(msg));
}

void send_channel(string channel, string message) {
    mapping msg = ([
        "version": "1.0", 
        "id": generate_uuid(),
        "timestamp": time_string(),
        "type": "channel",
        "from": ([ "mud": MUD_NAME, "user": this_player()->query_name() ]),
        "to": ([ "channel": channel ]),
        "payload": ([ "message": message ]),
        "metadata": ([ "priority": 5 ])
    ]);
    
    websocket->send(json_encode(msg));
}

// Handle incoming tells
void handle_incoming_tell(mapping msg) {
    string sender = msg["from"]["user"] + "@" + msg["from"]["mud"];
    string target = msg["to"]["user"];
    string message = msg["payload"]["message"];
    
    object user = find_player(target);
    if (user) {
        user->receive_message(sprintf("%%^CYAN%%^[MudVault Tell] %s tells you: %s%%^RESET%%^", 
                                     sender, message));
    }
}

// Handle incoming channel messages  
void handle_incoming_channel(mapping msg) {
    string sender = msg["from"]["user"] + "@" + msg["from"]["mud"];
    string channel = msg["to"]["channel"];
    string message = msg["payload"]["message"];
    
    // Broadcast to all users listening to this channel
    object *users = filter(users(), (: $1->query_listening(channel) :));
    
    foreach(object user in users) {
        user->receive_message(sprintf("%%^YELLOW%%^[%s] %s: %s%%^RESET%%^", 
                                     channel, sender, message));
    }
}

// Handle who requests
void handle_who_request(mapping msg) {
    object *online_users = users();
    mixed *user_list = ({});
    
    foreach(object user in online_users) {
        user_list += ({ ([
            "name": user->query_name(),
            "title": user->query_title(),
            "level": user->query_level(),
            "class": user->query_class(),
            "idle": user->query_idle_time()
        ]) });
    }
    
    mapping response = ([
        "version": "1.0",
        "id": generate_uuid(),
        "timestamp": time_string(),
        "type": "who",
        "from": ([ "mud": MUD_NAME ]),
        "to": msg["from"],
        "payload": ([ "users": user_list ]),
        "metadata": ([ "priority": 5 ])
    ]);
    
    websocket->send(json_encode(response));
}

// Handle Discord verification
void handle_discord_verification(string code) {
    // This would be called when a player types: mudvault verify ABCDEF
    object user = this_player();
    if (!user) return;
    
    mapping verify_msg = ([
        "version": "1.0",
        "id": generate_uuid(), 
        "timestamp": time_string(),
        "type": "custom",
        "from": ([ "mud": MUD_NAME, "user": user->query_name() ]),
        "to": ([ "mud": "DiscordBridge" ]),
        "payload": ([
            "type": "discord_verify",
            "code": code,
            "mudName": MUD_NAME,
            "username": user->query_name()
        ]),
        "metadata": ([ "priority": 10 ])
    ]);
    
    websocket->send(json_encode(verify_msg));
    user->write("Verification request sent to Discord.");
}

// Utility functions
string generate_uuid() {
    return sprintf("%08x-%04x-%04x-%04x-%012x",
                   random(0x100000000),
                   random(0x10000), 
                   random(0x10000),
                   random(0x10000),
                   random(0x1000000000000));
}

string time_string() {
    return sprintf("%d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                   localtime(time())[5] + 1900,
                   localtime(time())[4] + 1,
                   localtime(time())[3],
                   localtime(time())[2],
                   localtime(time())[1],
                   localtime(time())[0],
                   random(1000));
}
```

### Add Player Commands

Create `/cmds/player/mudvault.c`:

```lpc
// Player commands for MudVault interaction

int cmd_mudvault(string str) {
    object mudvault = load_object("/adm/etc/mudvault");
    
    if (!str) {
        write("Usage: mudvault <command> [args]");
        write("Commands:");
        write("  tell <mud>:<user> <message> - Send cross-MUD tell");
        write("  chat <channel> <message>    - Send to MudVault channel"); 
        write("  who                        - See who's online across MUDs");
        write("  verify <code>              - Verify Discord account");
        return 1;
    }
    
    string *parts = explode(str, " ");
    string cmd = parts[0];
    
    switch(cmd) {
        case "tell":
            if (sizeof(parts) < 3) {
                write("Usage: mudvault tell <mud>:<user> <message>");
                return 1;
            }
            string *target = explode(parts[1], ":");
            if (sizeof(target) != 2) {
                write("Format: <mud>:<user>");
                return 1;
            }
            string message = implode(parts[2..], " ");
            mudvault->send_tell(target[0], target[1], message);
            write(sprintf("Tell sent to %s@%s", target[1], target[0]));
            break;
            
        case "chat":
            if (sizeof(parts) < 3) {
                write("Usage: mudvault chat <channel> <message>");
                return 1;
            }
            string channel = parts[1];
            message = implode(parts[2..], " ");
            mudvault->send_channel(channel, message);
            write(sprintf("Message sent to [%s]", channel));
            break;
            
        case "who":
            mudvault->send_who_request();
            write("Requesting player list from MudVault network...");
            break;
            
        case "verify":
            if (sizeof(parts) != 2) {
                write("Usage: mudvault verify <code>");
                return 1;
            }
            mudvault->handle_discord_verification(parts[1]);
            break;
            
        default:
            write("Unknown command. Type 'mudvault' for help.");
    }
    
    return 1;
}
```

### For Python MUDs (like Evennia)

Install the client package:
```bash
pip install websockets asyncio
```

Create a MudVault integration:
```python
# mudvault_client.py
import asyncio
import websockets
import json
import uuid
from datetime import datetime

class MudVaultClient:
    def __init__(self, mud_name, mudvault_url, api_key=None):
        self.mud_name = mud_name
        self.mudvault_url = mudvault_url
        self.api_key = api_key
        self.websocket = None
        self.running = False
        
    async def connect(self):
        """Connect to MudVault network"""
        try:
            self.websocket = await websockets.connect(self.mudvault_url)
            self.running = True
            
            # Send authentication
            auth_msg = {
                "version": "1.0",
                "id": str(uuid.uuid4()),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "type": "auth",
                "from": {"mud": self.mud_name},
                "to": {"mud": "Gateway"},
                "payload": {"mudName": self.mud_name, "apiKey": self.api_key},
                "metadata": {"priority": 10}
            }
            
            await self.websocket.send(json.dumps(auth_msg))
            print(f"Connected to MudVault as {self.mud_name}")
            
            # Start message handler
            asyncio.create_task(self.message_handler())
            
        except Exception as e:
            print(f"Failed to connect to MudVault: {e}")
            
    async def message_handler(self):
        """Handle incoming messages"""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                await self.handle_message(data)
        except websockets.exceptions.ConnectionClosed:
            print("MudVault connection closed")
            self.running = False
            
    async def handle_message(self, msg):
        """Process incoming messages"""
        msg_type = msg.get("type")
        
        if msg_type == "tell":
            await self.handle_tell(msg)
        elif msg_type == "channel":
            await self.handle_channel(msg)
        elif msg_type == "who":
            await self.handle_who(msg)
        elif msg_type == "custom" and msg["payload"].get("type") == "discord_verify":
            await self.handle_discord_verification(msg["payload"]["code"])
            
    async def send_tell(self, target_mud, target_user, sender, message):
        """Send cross-MUD tell"""
        msg = {
            "version": "1.0",
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type": "tell",
            "from": {"mud": self.mud_name, "user": sender},
            "to": {"mud": target_mud, "user": target_user},
            "payload": {"message": message},
            "metadata": {"priority": 5}
        }
        
        await self.websocket.send(json.dumps(msg))
        
    async def send_channel(self, channel, sender, message):
        """Send channel message"""
        msg = {
            "version": "1.0",
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z", 
            "type": "channel",
            "from": {"mud": self.mud_name, "user": sender},
            "to": {"channel": channel},
            "payload": {"message": message},
            "metadata": {"priority": 5}
        }
        
        await self.websocket.send(json.dumps(msg))

# Integration with your MUD framework
mudvault = MudVaultClient("YourMudName", "ws://your-mudvault:8081")
asyncio.run(mudvault.connect())
```

## 3. ANSI Color Handling

The Discord service automatically handles ANSI escape codes that MUDs typically send. Here's how colors are translated:

### ANSI → Discord ANSI Translation

```javascript
// Standard ANSI codes are preserved for Discord
"\u001b[0;31m"  // Red
"\u001b[1;32m"  // Bright Green  
"\u001b[0;33m"  // Yellow
"\u001b[1;34m"  // Bright Blue
"\u001b[0;35m"  // Magenta
"\u001b[1;36m"  // Bright Cyan
"\u001b[0;37m"  // White
"\u001b[0m"     // Reset

// 256-color codes
"\u001b[38;5;196m"  // Bright red (color 196)
"\u001b[38;5;46m"   // Bright green (color 46)
```

### MUD Integration Tips

When sending messages to MudVault, include ANSI codes directly:

```lpc
// LPC example
string colored_message = sprintf("%%^RED%%^Important: %%^RESET%%^%s", message);
mudvault->send_channel("ooc", colored_message);
```

```python
# Python example  
colored_message = f"\u001b[0;31mImportant: \u001b[0m{message}"
await mudvault.send_channel("ooc", player.name, colored_message)
```

## 4. Testing the Setup

### Test MudVault Hub
```bash
curl http://localhost:8080/api/v1/health
```

### Test Discord Integration
1. Use `/verify YourMudName YourCharacter` in Discord
2. In your MUD: `mudvault verify ABCDEF` (using the code from Discord)
3. Send a message in the Discord bridge channel
4. Send a message from your MUD: `mudvault chat ooc Hello from the MUD!`

### Test Cross-MUD Communication
1. Connect multiple MUDs to the same hub
2. Use `mudvault tell AnotherMUD:PlayerName Hello!`
3. Use `mudvault who` to see players across all MUDs

## 5. Production Deployment

### Using Docker

```yaml
# docker-compose.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    
  mudvault:
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "8081:8081"
    environment:
      - REDIS_URL=redis://redis:6379
      - DISCORD_ENABLED=true
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - DISCORD_GUILD_ID=${DISCORD_GUILD_ID}
      - DISCORD_BRIDGE_CHANNEL_ID=${DISCORD_BRIDGE_CHANNEL_ID}
    depends_on:
      - redis
```

### Systemd Service

```ini
# /etc/systemd/system/mudvault.service
[Unit]
Description=MudVault Mesh Network Hub
After=network.target redis.service

[Service]
Type=simple
User=mudvault
WorkingDirectory=/opt/mudvault
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Troubleshooting

### Common Issues

1. **Discord bot not responding:**
   - Check bot permissions in Discord server
   - Verify `DISCORD_TOKEN` is correct
   - Ensure Message Content Intent is enabled

2. **MUD can't connect:**
   - Check firewall settings (port 8081)
   - Verify WebSocket URL is correct
   - Check MUD's WebSocket library

3. **Messages not bridging:**
   - Check Redis connection
   - Verify channel names match in configuration
   - Check user verification status

4. **ANSI colors not working:**
   - Ensure MUD sends proper ANSI escape codes
   - Check Discord client supports ANSI (desktop/web)
   - Verify message wrapping in ```ansi code blocks

This architecture provides a robust, scalable solution for connecting MUDs and Discord while maintaining the simplicity of a single service deployment.