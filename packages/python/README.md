# MudVault Mesh - Python Client

Connect your Python MUD to the MudVault Mesh network for seamless inter-MUD communication.

## Installation

```bash
pip install mudvault-mesh
```

## Quick Start

```python
import asyncio
from mudvault_mesh import MeshClient

async def main():
    # Create client
    client = MeshClient('YourMUDName')
    
    # Handle incoming tells
    client.on('tell', lambda message: print(
        f"{message.from_endpoint.user}@{message.from_endpoint.mud} tells you: {message.payload['message']}"
    ))
    
    # Handle channel messages
    def handle_channel(message):
        if message.payload.get('action') == 'message':
            print(f"[{message.payload['channel']}] {message.from_endpoint.user}@{message.from_endpoint.mud}: {message.payload['message']}")
    
    client.on('channel', handle_channel)
    
    # Connect to MudVault Mesh
    try:
        await client.connect()  # Defaults to wss://mesh.mudvault.org
        print('Connected to MudVault Mesh!')
        
        # Join a channel
        await client.join_channel('gossip', 'SystemBot')
        
        # Send a message
        await client.send_channel_message('gossip', 'Hello from our MUD!', 'SystemBot')
        
        # Keep running
        while client.is_connected:
            await asyncio.sleep(1)
            
    except Exception as error:
        print(f'Failed to connect: {error}')

# Run the client
asyncio.run(main())
```

## API Reference

### MeshClient

#### Constructor

```python
client = MeshClient(options)
```

**Options:**
- `mud_name` (str, required): Your MUD's unique name
- `auto_reconnect` (bool, default: True): Auto-reconnect on disconnect
- `reconnect_interval` (float, default: 5.0): Base reconnection delay in seconds
- `max_reconnect_attempts` (int, default: 10): Maximum reconnection attempts
- `heartbeat_interval` (float, default: 30.0): Heartbeat interval in seconds
- `timeout` (float, default: 10.0): Connection timeout in seconds

Or simply pass the MUD name as a string:

```python
client = MeshClient('YourMUDName')
```

#### Methods

##### Connection
- `await client.connect(gateway_url?, api_key?)` - Connect to mesh gateway
- `await client.disconnect()` - Disconnect from gateway
- `client.is_connected` - Check connection status
- `client.is_authenticated` - Check authentication status

##### Messaging
- `await client.send_tell(to_endpoint, message)` - Send private message
- `await client.send_channel_message(channel, message, user?)` - Send channel message
- `await client.join_channel(channel, user?)` - Join a channel
- `await client.leave_channel(channel, user?)` - Leave a channel

##### Information
- `await client.request_who(target_mud)` - Request who list from MUD
- `await client.request_finger(target_mud, target_user)` - Request user info
- `await client.request_locate(target_user)` - Find user across all MUDs

##### Presence
- `await client.set_user_online(user_info)` - Mark user as online
- `await client.set_user_offline(username)` - Mark user as offline

#### Events

```python
# Connection events
client.on('connected', lambda: print('Connected!'))
client.on('authenticated', lambda: print('Authenticated!'))
client.on('disconnected', lambda data: print(f'Disconnected: {data}'))
client.on('error', lambda error: print(f'Error: {error}'))

# Message events
client.on('tell', handle_tell)
client.on('channel', handle_channel) 
client.on('who', handle_who)
client.on('finger', handle_finger)
client.on('locate', handle_locate)
client.on('emote', handle_emote)
client.on('emoteto', handle_emoteto)

# Generic message event
client.on('message', handle_any_message)
```

## Message Format

All messages follow the MudVault Mesh protocol:

```python
{
    "version": "1.0",
    "id": "uuid-v4",
    "timestamp": "2025-01-08T12:00:00.000Z",
    "type": "tell|channel|who|etc",
    "from_endpoint": {
        "mud": "SenderMUD",
        "user": "username"
    },
    "to_endpoint": {
        "mud": "TargetMUD",
        "user": "username", 
        "channel": "channelname"
    },
    "payload": {
        # Message-specific data
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

```python
import asyncio
from mudvault_mesh import MeshClient, MessageEndpoint

client = MeshClient('MyMUD')

async def handle_tell(message):
    from_user = f"{message.from_endpoint.user}@{message.from_endpoint.mud}"
    to_user = message.to_endpoint.user
    text = message.payload['message']
    
    # Send to your MUD's player
    await send_to_player(to_user, f"{from_user} tells you: {text}")

client.on('tell', handle_tell)

# Send tell from your MUD
async def mud_tell(from_user, to_mud, to_user, message):
    to_endpoint = MessageEndpoint(mud=to_mud, user=to_user)
    await client.send_tell(to_endpoint, message)
```

### Channel Integration

```python
async def handle_channel(message):
    channel = message.payload['channel']
    action = message.payload.get('action', 'message')
    
    if action == 'message':
        from_user = f"{message.from_endpoint.user}@{message.from_endpoint.mud}"
        await broadcast_to_channel(channel, f"[{channel}] {from_user}: {message.payload['message']}")
    
    elif action == 'join':
        await broadcast_to_channel(channel, f"{message.from_endpoint.user}@{message.from_endpoint.mud} joined {channel}")
    
    elif action == 'leave':
        await broadcast_to_channel(channel, f"{message.from_endpoint.user}@{message.from_endpoint.mud} left {channel}")

client.on('channel', handle_channel)

# Channel commands from your MUD
async def join_mesh_channel(channel, username):
    await client.join_channel(channel, username)

async def send_to_mesh_channel(channel, message, username):
    await client.send_channel_message(channel, message, username)
```

### Who List Integration

```python
async def handle_who(message):
    if 'users' in message.payload:
        # Response to who request
        users = message.payload['users']
        mud_name = message.from_endpoint.mud
        
        print(f"Users online at {mud_name}:")
        for user in users:
            print(f"  {user['username']} - Level {user.get('level', 'Unknown')} {user.get('race', '')} {user.get('class_name', '')}")

client.on('who', handle_who)

# Request who list
async def check_who_on_mud(mud_name):
    await client.request_who(mud_name)
```

### Error Handling

```python
client.on('error', lambda error: print(f'Mesh client error: {error}'))

client.on('reconnecting', lambda data: print(f"Reconnecting to mesh... attempt {data['attempt']}"))

client.on('reconnect_failed', lambda data: print(f"Reconnect attempt {data['attempt']} failed: {data['error']}"))

client.on('reconnect_give_up', lambda: print('Max reconnection attempts reached, giving up'))
```

### Complete Integration Example

```python
import asyncio
import logging
from mudvault_mesh import MeshClient, MessageEndpoint, UserInfo

# Setup logging
logging.basicConfig(level=logging.INFO)

class MUDMeshIntegration:
    def __init__(self, mud_name):
        self.client = MeshClient(mud_name)
        self.setup_handlers()
    
    def setup_handlers(self):
        # Connection events
        self.client.on('connected', self.on_connected)
        self.client.on('authenticated', self.on_authenticated)
        self.client.on('disconnected', self.on_disconnected)
        self.client.on('error', self.on_error)
        
        # Message events
        self.client.on('tell', self.on_tell)
        self.client.on('channel', self.on_channel)
        self.client.on('who', self.on_who)
        self.client.on('locate', self.on_locate)
    
    async def on_connected(self):
        print('Connected to MudVault Mesh!')
        # Join default channels
        await self.client.join_channel('gossip', 'System')
        await self.client.join_channel('newbie', 'Helper')
    
    async def on_authenticated(self):
        print('Authenticated with MudVault Mesh!')
    
    async def on_disconnected(self, data):
        print(f'Disconnected from mesh: {data}')
    
    async def on_error(self, error):
        print(f'Mesh error: {error}')
    
    async def on_tell(self, message):
        # Forward tell to MUD player
        from_user = f"{message.from_endpoint.user}@{message.from_endpoint.mud}"
        to_user = message.to_endpoint.user
        text = message.payload['message']
        
        # Your MUD's tell system
        await self.send_to_mud_player(to_user, f"{from_user} tells you: {text}")
    
    async def on_channel(self, message):
        # Forward channel message to MUD
        channel = message.payload['channel']
        action = message.payload.get('action', 'message')
        
        if action == 'message':
            from_user = f"{message.from_endpoint.user}@{message.from_endpoint.mud}"
            text = message.payload['message']
            await self.broadcast_to_mud_channel(channel, f"[{channel}] {from_user}: {text}")
    
    async def on_who(self, message):
        # Handle who list responses
        if 'users' in message.payload:
            users = message.payload['users']
            mud_name = message.from_endpoint.mud
            
            # Format and display who list
            who_list = f"Users online at {mud_name}:\n"
            for user in users:
                who_list += f"  {user['username']}\n"
            
            # Send to requesting player or broadcast
            await self.display_who_list(who_list)
    
    async def on_locate(self, message):
        # Handle locate responses
        if 'locations' in message.payload:
            user = message.payload['user']
            locations = message.payload['locations']
            
            if locations:
                result = f"{user} found at: " + ", ".join([loc['mud'] for loc in locations if loc['online']])
            else:
                result = f"{user} not found on any connected MUD"
            
            await self.display_locate_result(result)
    
    async def start(self):
        """Start the mesh client."""
        try:
            await self.client.connect()
            # Keep running
            while self.client.is_connected:
                await asyncio.sleep(1)
        except Exception as e:
            print(f'Failed to start mesh client: {e}')
    
    # Integration methods (implement these for your MUD)
    async def send_to_mud_player(self, player_name, message):
        """Send message to a player in your MUD."""
        # Implement your MUD's player messaging
        print(f"To {player_name}: {message}")
    
    async def broadcast_to_mud_channel(self, channel, message):
        """Broadcast message to a channel in your MUD."""
        # Implement your MUD's channel broadcasting
        print(f"Channel {channel}: {message}")
    
    async def display_who_list(self, who_list):
        """Display who list to appropriate players."""
        print(who_list)
    
    async def display_locate_result(self, result):
        """Display locate result to appropriate players."""
        print(result)
    
    # MUD command handlers
    async def handle_mesh_tell(self, from_player, target_mud, target_user, message):
        """Handle tell command from MUD player."""
        to_endpoint = MessageEndpoint(mud=target_mud, user=target_user)
        # Set the from user to the actual player
        self.client._options.mud_name = self.client._options.mud_name  # Keep MUD name
        await self.client.send_tell(to_endpoint, message)
    
    async def handle_mesh_channel(self, from_player, channel, message):
        """Handle channel message from MUD player."""
        await self.client.send_channel_message(channel, message, from_player)
    
    async def handle_mesh_who(self, requesting_player, target_mud):
        """Handle who request from MUD player."""
        await self.client.request_who(target_mud)
    
    async def handle_mesh_locate(self, requesting_player, target_user):
        """Handle locate request from MUD player."""
        await self.client.request_locate(target_user)
    
    async def player_login(self, player_name, player_info):
        """Called when a player logs into your MUD."""
        user_info = UserInfo(
            username=player_name,
            level=player_info.get('level'),
            race=player_info.get('race'),
            class_name=player_info.get('class'),
            location=player_info.get('location')
        )
        await self.client.set_user_online(user_info)
    
    async def player_logout(self, player_name):
        """Called when a player logs out of your MUD."""
        await self.client.set_user_offline(player_name)

# Usage
async def main():
    integration = MUDMeshIntegration('MyAwesomeMUD')
    await integration.start()

if __name__ == '__main__':
    asyncio.run(main())
```

## Type Hints

Full type hints are provided for all functions and classes:

```python
from typing import Optional, Dict, Any
from mudvault_mesh import MeshClient, MeshMessage, MessageEndpoint

client: MeshClient = MeshClient('MyMUD')

async def handle_message(message: MeshMessage) -> None:
    # Fully typed message object
    print(message.payload)

client.on('message', handle_message)
```

## License

MIT License - see LICENSE file for details.

## Support

- **Discord**: [Join our community](https://discord.gg/r6kM56YrEV)
- **GitHub**: [Report issues](https://github.com/Coffee-Nerd/OpenIMC/issues)
- **Documentation**: [Full protocol docs](https://github.com/Coffee-Nerd/OpenIMC/docs)