# DikuMUD/Merc Integration with MudVault Mesh

This example shows how to integrate your DikuMUD or CircleMUD-based MUD with the MudVault Mesh network for inter-MUD communication.

## Quick Start

1. **Copy the integration files** to your MUD source directory
2. **Add the files to your Makefile**
3. **Configure your MUD settings**
4. **Compile and connect**

## Files Included

- `mudvault_mesh.h` - Header file with structures and function declarations
- `mudvault_mesh.c` - Core MudVault Mesh integration code
- `mvm_commands.c` - Player commands (mvm tell, mvm who, etc.)
- `mvm_config.h` - Configuration settings
- `Makefile.example` - Example Makefile additions

## Installation Steps

### 1. Copy Files

Copy all `.c` and `.h` files to your MUD's `src/` directory:

```bash
cp examples/dikumud/*.c src/
cp examples/dikumud/*.h src/
```

### 2. Update Makefile

Add to your `src/Makefile`:

```makefile
# MudVault Mesh Integration
MVM_OBJS = mudvault_mesh.o mvm_commands.o

# Add to your existing OBJS line
OBJS = ... $(MVM_OBJS)

# Add dependencies
mudvault_mesh.o: mudvault_mesh.c mudvault_mesh.h mvm_config.h
mvm_commands.o: mvm_commands.c mudvault_mesh.h
```

### 3. Configuration

Edit `mvm_config.h` with your MUD's settings:

```c
#define MVM_MUD_NAME     "YourMUDName"          // Must be unique
#define MVM_GATEWAY_HOST "mesh.mudvault.org"    // MudVault Mesh gateway
#define MVM_GATEWAY_PORT 8081                   // WebSocket port
#define MVM_API_KEY      "your-api-key"         // Get from registration
```

### 4. Add to main.c

Add these includes and calls to your main game loop:

```c
#include "mudvault_mesh.h"

// In main() function, after other initializations:
if (mvm_startup() < 0) {
    log("SYSERR: Could not initialize MudVault Mesh");
    exit(1);
}

// In your main game loop (usually in comm.c):
mvm_loop();

// In shutdown sequence:
mvm_shutdown();
```

### 5. Add Commands

Add command entry to your command table (usually in interpreter.c):

```c
{ "mvm"      , POS_SLEEPING, do_mvm      , 0, 0 },
```

**Optional channel aliases** (add these if you want quick channel access):
```c
{ "gossip"   , POS_SLEEPING, do_gossip   , 0, 0 },
{ "ooc"      , POS_SLEEPING, do_ooc      , 0, 0 },
```

### 6. Player Events

Add these calls where appropriate in your MUD:

```c
// When player logs in:
mvm_player_login(ch);

// When player logs out:
mvm_player_logout(ch);

// When player changes rooms:
mvm_player_moved(ch, from_room, to_room);

// When player goes idle/unidle:
mvm_player_idle(ch, idle_time);
```

## Registration

Before connecting, register your MUD with the MudVault Mesh network:

```bash
curl -X POST https://mesh.mudvault.org/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "mudName": "YourMUDName", 
    "adminEmail": "admin@yourmud.com"
  }'
```

Save the returned API key and add it to `mvm_config.h`.

## Player Commands

Once integrated, players can use these commands:

### MudVault Mesh Commands
```
mvm tell player@mudname message  - Send tell to player on another MUD
mvm who [mudname]                - See who's online (all MUDs or specific MUD)
mvm finger player@mudname        - Get info about a player
mvm locate player                - Find which MUD a player is on
mvm channels                     - List available channels  
mvm join channel                 - Join a channel
mvm leave channel                - Leave a channel
mvm list                         - List connected MUDs
mvm stats                        - Show mesh statistics
```

### Channel Shortcuts (optional aliases)
```
gossip message                   - Send to gossip channel (if aliased)
ooc message                      - Send to OOC channel (if aliased)
```

## Advanced Features

### Custom Channels

Create MUD-specific channels in your startup code:

```c
void create_mud_channels(void) {
    imc_create_channel("newbie", "Newbie help channel", FALSE);
    imc_create_channel("admin", "Admin channel", TRUE);  // Restricted
}
```

### Message Filtering

Add content filtering in `openimc.c`:

```c
bool imc_filter_message(char *message) {
    // Add your profanity filter, spam detection, etc.
    if (strstr(message, "spam_word"))
        return FALSE;
    return TRUE;
}
```

### Custom Commands

Add MUD-specific IMC commands:

```c
ACMD(do_auction) {
    char item[MAX_INPUT_LENGTH], price[MAX_INPUT_LENGTH];
    
    two_arguments(argument, item, price);
    
    if (!*item || !*price) {
        send_to_char(ch, "Usage: auction <item> <price>\n");
        return;
    }
    
    imc_send_auction(ch, item, atoi(price));
}
```

## Troubleshooting

### Common Issues

1. **Connection Failed**
   - Check IMC_GATEWAY_HOST and IMC_GATEWAY_PORT
   - Verify your API key is correct
   - Ensure firewall allows outbound connections

2. **Authentication Error**
   - Register your MUD first
   - Check API key in imc_config.h
   - Verify MUD name is unique

3. **Messages Not Received**
   - Check if imc_loop() is being called
   - Verify player is properly logged in with imc_player_login()
   - Check log files for error messages

### Debug Mode

Enable debug logging in `imc_config.h`:

```c
#define IMC_DEBUG 1
```

This will log all IMC activity to your MUD's log files.

### Log Messages

Watch for these in your logs:
```
MudVault Mesh: Connected to gateway
MudVault Mesh: Authenticated successfully
MudVault Mesh: Player John logged in
MudVault Mesh: Received tell from Jane@OtherMUD
```

## Performance Notes

- The integration uses non-blocking sockets
- Minimal CPU overhead (~0.1% on typical MUDs)
- Memory usage: ~50KB per 1000 connected MUDs
- Network usage: ~1KB/minute for idle MUD

## Support

- **Documentation**: https://github.com/Coffee-Nerd/OpenIMC/docs
- **Discord**: https://discord.gg/r6kM56YrEV
- **Issues**: https://github.com/Coffee-Nerd/OpenIMC/issues
- **Email**: asmodeusbrooding@gmail.com

## License

This integration code is released under the MIT License, same as MudVault Mesh.

---

**Ready to connect your MUD to the MudVault Mesh network? Follow the steps above and join the inter-MUD community!**