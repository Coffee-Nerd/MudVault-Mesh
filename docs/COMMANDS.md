# MudVault Mesh Commands Reference

This document provides complete JSON message formats for all MudVault Mesh commands, including what to send and what responses to expect.

## Message Format Overview

All MudVault Mesh messages follow this structure:

```json
{
  "version": "1.0",
  "id": "uuid-v4-here",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "message_type",
  "from": {"mud": "YourMudName", "user": "username"},
  "to": {"mud": "TargetMud", "user": "target_user", "channel": "channel_name"},
  "payload": { /* command-specific data */ },
  "metadata": {
    "priority": 5,
    "ttl": 300,
    "encoding": "utf-8",
    "language": "en"
  }
}
```

**Important Notes:**
- MUD names **cannot contain spaces** (use dashes: `Dark-Wizardry` not `Dark Wizardry`)
- MUD names are case-insensitive for lookups (but preserve original case when storing)
- Commands to query network info (`who`, `mudlist`, `channels`, `locate`) go to `"Gateway"`
- Commands to specific MUDs (`tell`, `finger`) go to the target MUD
- All UUIDs must be valid v4 format
- Timestamps must be ISO 8601 format
- TTL is in seconds (default: 300 = 5 minutes)
- Priority is 1-10 (1=lowest, 10=highest, default=5)

---

## 1. Tell Commands

### `mudvault tell <player@mud> <message>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "tell",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Avalon", "user": "Asmodeus"},
  "payload": {
    "message": "Hello from Dark Wizardry!",
    "formatted": "\u001b[1;36mHello from Dark Wizardry!\u001b[0m"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Success Response:** *(None - message is delivered directly to target)*

**Error Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "error",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "code": 1003,
    "message": "MUD Avalon not found",
    "details": {"availableMuds": ["Dark-Wizardry", "TestMUD"]}
  },
  "metadata": {"priority": 10, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault reply <message>`

*(Handled client-side by tracking last tell sender)*

---

## 2. Channel Commands

### `mudvault chat <channel> <message>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "channel",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "*", "channel": "ooc"},
  "payload": {
    "channel": "ooc",
    "message": "Hello everyone!",
    "action": "message",
    "formatted": "\u001b[1;32mHello everyone!\u001b[0m"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Success Response:** *(Message is broadcast to all connected MUDs)*

### `mudvault join <channel>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "channel",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "*", "channel": "ooc"},
  "payload": {
    "channel": "ooc",
    "action": "join"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault leave <channel>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "channel",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "*", "channel": "ooc"},
  "payload": {
    "channel": "ooc",
    "action": "leave"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 3. Emote Commands

### `mudvault emote <mud> <action>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "emote",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Avalon"},
  "payload": {
    "action": "waves hello to everyone",
    "formatted": "\u001b[1;33mDemon waves hello to everyone\u001b[0m"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault emoteto <player@mud> <action>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "emoteto",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Avalon", "user": "Asmodeus"},
  "payload": {
    "action": "waves at you",
    "target": "Asmodeus",
    "formatted": "\u001b[1;33mDemon waves at you\u001b[0m"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 4. Information Commands

### `mudvault who [mud]`

**Important Note:** When requesting a network-wide "who", the Gateway returns **connected MUDs** as "users", not actual players. This shows which MUDs are online in the network.

**Security & Privacy:** The Gateway NEVER reveals player locations or sensitive game data. The `location` field shows network information (IP addresses) where MUD servers are hosted, NOT in-game room locations. This protects players from PK tracking, stalking, and meta-gaming across MUDs.

To see actual players, request "who" from a specific MUD (each MUD controls its own privacy policy).

**Send (network-wide who - shows connected MUDs):**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "who",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Gateway"},
  "payload": {
    "request": true,
    "sort": "alpha",
    "format": "long"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Send (specific MUD who - shows actual players on that MUD):**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "who",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Avalon"},
  "payload": {
    "request": true,
    "sort": "alpha",
    "format": "long"
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Response (from specific MUD - shows real players with in-game info):**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "who",
  "from": {"mud": "Avalon"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "request": false,
    "users": [
      {
        "username": "Asmodeus",
        "displayName": "Asmodeus the Demon Lord",
        "title": "Lord of the Abyss",
        "level": "100",
        "idle": 45,
        "location": "The Throne Room",  // In-game location (MUD's choice to share)
        "flags": ["admin", "coder"],
        "realName": "The Dark Lord"
      }
    ]
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Note:** Individual MUDs control their own privacy policy and may choose to show or hide player locations.

**Response (from Gateway - shows connected MUDs as "users"):**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "who",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "request": false,
    "users": [
      {
        "username": "Dark-Wizardry",
        "displayName": "Dark-Wizardry",
        "title": "",
        "level": "",
        "idle": 0,
        "location": "86.38.203.37",  // Network location (server IP) - NOT game location for security
        "flags": ["mud", "system"],
        "realName": "Dark-Wizardry (Connected 3600s ago)"
      },
      {
        "username": "TestMUD",
        "displayName": "TestMUD",
        "title": "",
        "level": "",
        "idle": 0,
        "location": "192.168.1.100",  // Network location (server IP)
        "flags": ["mud", "system"],
        "realName": "TestMUD (Connected 120s ago)"
      }
    ]
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault finger <player@mud>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "finger",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Avalon", "user": "Asmodeus"},
  "payload": {
    "user": "Asmodeus",
    "request": true
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "finger",
  "from": {"mud": "Avalon", "user": "Asmodeus"},
  "to": {"mud": "Dark-Wizardry", "user": "Demon"},
  "payload": {
    "user": "Asmodeus",
    "request": false,
    "info": {
      "username": "Asmodeus",
      "realName": "The Dark Lord",
      "email": "asmodeus@avalon.mud",
      "lastLogin": "2025-01-26T12:30:00.000Z",
      "plan": "Working on inter-MUD domination",
      "level": "100",
      "location": "The Throne Room",
      "idle": 45
    }
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault locate <player>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "locate",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Gateway"},
  "payload": {
    "user": "Asmodeus",
    "request": true
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "locate",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "user": "Asmodeus",
    "request": false,
    "locations": [
      {
        "mud": "Avalon",
        "online": true,
        "location": "The Throne Room",
        "idle": 45
      },
      {
        "mud": "TestMUD",
        "online": false,
        "lastSeen": "2025-01-25T18:30:00.000Z"
      }
    ]
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 5. Network Commands

### `mudvault channels`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "channels",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Gateway"},
  "payload": {
    "request": true
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "channels",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "request": false,
    "channels": [
      {
        "name": "ooc",
        "description": "Out of Character chat",
        "memberCount": 15,
        "flags": ["public"]
      },
      {
        "name": "chat",
        "description": "General chat channel",
        "memberCount": 23,
        "flags": ["public"]
      },
      {
        "name": "gossip",
        "description": "Gossip and rumors",
        "memberCount": 8,
        "flags": ["public"]
      },
      {
        "name": "admin",
        "description": "Administrative channel",
        "memberCount": 3,
        "flags": ["private", "admin"]
      }
    ]
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

### `mudvault list`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "mudlist",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "Gateway"},
  "payload": {
    "request": true
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "mudlist",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "request": false,
    "muds": [
      {
        "name": "Dark-Wizardry",
        "host": "86.38.203.37",
        "version": "1.0",
        "admin": "",
        "email": "",
        "uptime": 3600,
        "users": 0,
        "description": "Dark-Wizardry MUD Server"
      },
      {
        "name": "TestMUD",
        "host": "192.168.1.100",
        "version": "1.0",
        "admin": "",
        "email": "",
        "uptime": 7200,
        "users": 0,
        "description": "TestMUD MUD Server"
      }
    ]
  },
  "metadata": {"priority": 5, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 6. Special Commands

### `mudvault verify <code>`

**Send:**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "tell",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "DiscordBridge", "user": "discord"},
  "payload": {
    "message": "DISCORD_VERIFY:ABC123"
  },
  "metadata": {"priority": 10, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**Success Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "tell",
  "from": {"mud": "DiscordBridge", "user": "discord"},
  "to": {"mud": "Dark-Wizardry", "user": "Demon"},
  "payload": {
    "message": "Your Discord account has been successfully linked! You can now chat through Discord."
  },
  "metadata": {"priority": 10, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 7. Presence/Status Commands  

### Presence Updates (Automatic)

**Send (when user logs in/out):**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "presence",
  "from": {"mud": "Dark-Wizardry", "user": "Demon"},
  "to": {"mud": "*"},
  "payload": {
    "status": "online",
    "activity": "Fighting dragons",
    "location": "Dragon's Lair"
  },
  "metadata": {"priority": 3, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

---

## 8. Ping/Keepalive

**Send (heartbeat):**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "ping",
  "from": {"mud": "Dark-Wizardry"},
  "to": {"mud": "Gateway"},
  "payload": {
    "timestamp": 1706271296789
  },
  "metadata": {"priority": 1, "ttl": 60, "encoding": "utf-8", "language": "en"}
}
```

**Response:**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "pong",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "timestamp": 1706271296789
  },
  "metadata": {"priority": 1, "ttl": 60, "encoding": "utf-8", "language": "en"}
}
```

---

## Error Codes

| Code | Description | Example Scenario |
|------|-------------|------------------|
| 1000 | Invalid Message | Malformed JSON or missing required fields |
| 1001 | Authentication Failed | Invalid MUD name or missing credentials |
| 1002 | Unauthorized | Attempting restricted operation |
| 1003 | MUD Not Found | Target MUD not connected |
| 1004 | User Not Found | Target user not online |
| 1005 | Channel Not Found | Invalid channel name |
| 1006 | Rate Limited | Too many messages sent |
| 1007 | Internal Error | Server-side error |
| 1008 | Protocol Error | Unsupported message type |
| 1009 | Unsupported Version | Wrong protocol version |
| 1010 | Message Too Large | Message exceeds size limit |

---

## Authentication Process

Before sending any commands, your MUD must authenticate with the gateway:

**1. Connect to WebSocket**
```
ws://ws.mesh.mudvault.org
```

**2. Send Authentication**
```json
{
  "version": "1.0",
  "id": "12345678-1234-4567-8901-123456789abc",
  "timestamp": "2025-01-26T12:34:56.789Z",
  "type": "auth",
  "from": {"mud": "Dark-Wizardry"},
  "to": {"mud": "Gateway"},
  "payload": {
    "mudName": "Dark-Wizardry",
    "apiKey": "your-api-key-here"
  },
  "metadata": {"priority": 10, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**3. Receive Success Response**
```json
{
  "version": "1.0",
  "id": "87654321-4321-7654-1098-987654321cba",
  "timestamp": "2025-01-26T12:34:57.123Z",
  "type": "auth",
  "from": {"mud": "Gateway"},
  "to": {"mud": "Dark-Wizardry"},
  "payload": {
    "mudName": "Dark-Wizardry",
    "response": "Authentication successful"
  },
  "metadata": {"priority": 10, "ttl": 300, "encoding": "utf-8", "language": "en"}
}
```

**4. Start Sending Commands**

After successful authentication, you can send any of the above commands.

---

## Client Implementation Notes

1. **Always validate MUD names** - No spaces allowed, use dashes
2. **Generate unique UUIDs** for each message ID  
3. **Handle timeouts** - Messages expire after TTL seconds
4. **Implement reconnection** - WebSocket may disconnect
5. **Track tell senders** - For reply functionality
6. **Cache user info** - For better UX
7. **Handle errors gracefully** - Show meaningful messages to users
8. **Respect rate limits** - Don't spam the network

---

## Command Priority Guidelines

- **High Priority (8-10)**: auth, verify, admin commands
- **Medium Priority (4-7)**: tell, who, finger, channel messages  
- **Low Priority (1-3)**: ping, presence updates, automated messages

---

This completes the comprehensive command reference for MudVault Mesh protocol implementation.