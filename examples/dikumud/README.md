# DikuMUD/Merc Integration with OpenIMC

This example shows how to integrate your DikuMUD or CircleMUD-based MUD with the OpenIMC network for inter-MUD communication.

## Quick Start

1. **Copy the integration files** to your MUD source directory
2. **Add the files to your Makefile**
3. **Configure your MUD settings**
4. **Compile and connect**

## Files Included

- `openimc.h` - Header file with structures and function declarations
- `openimc.c` - Core OpenIMC integration code
- `imc_commands.c` - Player commands (tell, who, finger, etc.)
- `imc_config.h` - Configuration settings
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
# OpenIMC Integration
OPENIMC_OBJS = openimc.o imc_commands.o

# Add to your existing OBJS line
OBJS = ... $(OPENIMC_OBJS)

# Add dependencies
openimc.o: openimc.c openimc.h imc_config.h
imc_commands.o: imc_commands.c openimc.h
```

### 3. Configuration

Edit `imc_config.h` with your MUD's settings:

```c
#define IMC_MUD_NAME     "YourMUDName"      // Must be unique
#define IMC_GATEWAY_HOST "mudvault.org"     // Or your gateway
#define IMC_GATEWAY_PORT 8081               // WebSocket port
#define IMC_API_KEY      "your-api-key"     // Get from registration
```

### 4. Add to main.c

Add these includes and calls to your main game loop:

```c
#include "openimc.h"

// In main() function, after other initializations:
if (imc_startup() < 0) {
    log("SYSERR: Could not initialize OpenIMC");
    exit(1);
}

// In your main game loop (usually in comm.c):
imc_loop();

// In shutdown sequence:
imc_shutdown();
```

### 5. Add Commands

Add command entries to your command table (usually in interpreter.c):

```c
{ "imctell"  , POS_SLEEPING, do_imctell  , 0, 0 },
{ "imcwho"   , POS_SLEEPING, do_imcwho   , 0, 0 },
{ "imcfinger", POS_SLEEPING, do_imcfinger, 0, 0 },
{ "channels" , POS_SLEEPING, do_channels , 0, 0 },
{ "imclist"  , POS_SLEEPING, do_imclist  , 0, 0 },
```

### 6. Player Events

Add these calls where appropriate in your MUD:

```c
// When player logs in:
imc_player_login(ch);

// When player logs out:
imc_player_logout(ch);

// When player changes rooms:
imc_player_moved(ch, from_room, to_room);

// When player goes idle/unidle:
imc_player_idle(ch, idle_time);
```

## Registration

Before connecting, register your MUD with the OpenIMC network:

```bash
curl -X POST https://mudvault.org/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "mudName": "YourMUDName",
    "adminEmail": "admin@yourmud.com"
  }'
```

Save the returned API key and add it to `imc_config.h`.

## Player Commands

Once integrated, players can use these commands:

### Inter-MUD Communication
```
imctell player@mudname message   - Send tell to player on another MUD
imcwho mudname                   - See who's online on another MUD  
imcfinger player@mudname         - Get info about a player
imclocate player                 - Find which MUD a player is on
```

### Channels
```
channels                         - List available channels
channel gossip Hello everyone!   - Send message to gossip channel
chjoin gossip                    - Join the gossip channel
chleave gossip                   - Leave the gossip channel
```

### Information
```
imclist                          - List connected MUDs
imcstats                         - Show IMC statistics
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
OpenIMC: Connected to gateway
OpenIMC: Authenticated successfully
OpenIMC: Player John logged in
OpenIMC: Received tell from Jane@OtherMUD
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

This integration code is released under the MIT License, same as OpenIMC.

---

**Ready to connect your MUD to the OpenIMC network? Follow the steps above and join the inter-MUD community!**