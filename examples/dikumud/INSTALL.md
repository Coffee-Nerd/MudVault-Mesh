# MudVault Mesh DikuMUD Integration - Installation Guide

This guide will walk you through integrating MudVault Mesh with your DikuMUD, CircleMUD, or Merc-based MUD.

## Prerequisites

- A working DikuMUD/CircleMUD/Merc codebase
- GCC compiler with development headers
- OpenSSL development libraries
- Make utility

### Installing Prerequisites

#### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install build-essential libssl-dev
```

#### CentOS/RHEL/Fedora:
```bash
sudo yum install gcc gcc-c++ make openssl-devel
# OR for newer versions:
sudo dnf install gcc gcc-c++ make openssl-devel
```

## Step 1: Copy Integration Files

Copy all the MudVault Mesh integration files to your MUD's source directory:

```bash
# From the MudVault Mesh repository
cp examples/dikumud/*.c /path/to/your/mud/src/
cp examples/dikumud/*.h /path/to/your/mud/src/
```

## Step 2: Configure Your MUD

Edit `src/imc_config.h` with your MUD's specific settings:

```c
#define IMC_MUD_NAME        "YourUniqueMUDName"
#define IMC_GATEWAY_HOST    "mudvault.org"
#define IMC_GATEWAY_PORT    8081
#define IMC_API_KEY         "your-api-key-here"
#define IMC_ADMIN_EMAIL     "admin@yourmud.com"
```

### MUD Type Configuration

Uncomment the line that matches your MUD type:

```c
/* #define CIRCLE_MUD      1 */
/* #define DIKUMUD         1 */
/* #define MERC            1 */
/* #define ROM             1 */
/* #define SMAUG           1 */
```

## Step 3: Update Your Makefile

Add the MudVault Mesh objects to your Makefile. Here's an example for CircleMUD:

```makefile
# Add these lines to your Makefile
MUDVAULT_MESH_OBJS = openimc.o imc_commands.o websocket.o json_simple.o

# Modify your OBJFILES line to include MudVault Mesh objects
OBJFILES = comm.o act.comm.o act.informative.o ... $(MUDVAULT_MESH_OBJS)

# Add OpenSSL to your LIBS line
LIBS = -lcrypt -lssl -lcrypto

# Add dependencies
openimc.o: openimc.c openimc.h imc_config.h
imc_commands.o: imc_commands.c openimc.h
websocket.o: websocket.c openimc.h
json_simple.o: json_simple.c json.h openimc.h
```

## Step 4: Modify Your Main Code

### 4.1 Add Header Include

In your main header file (usually `structs.h` or similar), add:

```c
#include "openimc.h"
```

### 4.2 Initialize MudVault Mesh

In your main function (usually in `comm.c` or `main.c`), add:

```c
/* After other initializations, before entering main loop */
if (imc_startup() < 0) {
    log("SYSERR: Could not initialize MudVault Mesh");
    /* Don't exit - just continue without IMC */
}
```

### 4.3 Add to Main Loop

In your main game loop (usually in `comm.c`), add:

```c
/* In your main loop, after processing player input */
imc_loop();
```

### 4.4 Add Shutdown

In your shutdown sequence, add:

```c
/* Before final exit */
imc_shutdown();
```

## Step 5: Add Commands

### 5.1 Command Table

The command table format varies by MUD type. Here are examples:

#### For Merc/ROM/Smaug (most common):
```c
/* Add these to your command table (usually in tables.c) */
{ "imctell",     do_imctell,     POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imcemote",    do_imcemote,    POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imcwho",      do_imcwho,      POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imcfinger",   do_imcfinger,   POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imclocate",   do_imclocate,   POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imclist",     do_imclist,     POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imcstats",    do_imcstats,    POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "channels",    do_channels,    POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "channel",     do_channel,     POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "chjoin",      do_chjoin,      POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "chleave",     do_chleave,     POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imchelp",     do_imchelp,     POS_DEAD,    0,  LOG_NORMAL, 1 },
{ "imcreconnect", do_imcreconnect, POS_DEAD,  MAX_LEVEL-1, LOG_ALWAYS, 1 },
```

#### For CircleMUD:
```c
/* Add these to cmd_info[] array in interpreter.c */
{ "imctell"   , POS_SLEEPING, do_imctell   , 0, 0 },
{ "imcemote"  , POS_SLEEPING, do_imcemote  , 0, 0 },
{ "imcwho"    , POS_SLEEPING, do_imcwho    , 0, 0 },
{ "imcfinger" , POS_SLEEPING, do_imcfinger , 0, 0 },
{ "imclocate" , POS_SLEEPING, do_imclocate , 0, 0 },
{ "imclist"   , POS_SLEEPING, do_imclist   , 0, 0 },
{ "imcstats"  , POS_SLEEPING, do_imcstats  , 0, 0 },
{ "channels"  , POS_SLEEPING, do_channels  , 0, 0 },
{ "channel"   , POS_SLEEPING, do_channel   , 0, 0 },
{ "chjoin"    , POS_SLEEPING, do_chjoin    , 0, 0 },
{ "chleave"   , POS_SLEEPING, do_chleave   , 0, 0 },
{ "imchelp"   , POS_SLEEPING, do_imchelp   , 0, 0 },
{ "imcreconnect", POS_SLEEPING, do_imcreconnect, LVL_GRGOD, 0 },
```

### 5.2 Function Declarations

Add these function declarations to your header file:

#### For Merc/ROM/Smaug:
```c
/* MudVault Mesh command functions */
DO_FUN(do_imctell);
DO_FUN(do_imcemote);
DO_FUN(do_imcwho);
DO_FUN(do_imcfinger);
DO_FUN(do_imclocate);
DO_FUN(do_imclist);
DO_FUN(do_imcstats);
DO_FUN(do_channels);
DO_FUN(do_channel);
DO_FUN(do_chjoin);
DO_FUN(do_chleave);
DO_FUN(do_imchelp);
DO_FUN(do_imcreconnect);
```

#### For CircleMUD:
```c
/* MudVault Mesh command functions */
ACMD(do_imctell);
ACMD(do_imcemote);
ACMD(do_imcwho);
ACMD(do_imcfinger);
ACMD(do_imclocate);
ACMD(do_imclist);
ACMD(do_imcstats);
ACMD(do_channels);
ACMD(do_channel);
ACMD(do_chjoin);
ACMD(do_chleave);
ACMD(do_imchelp);
ACMD(do_imcreconnect);
```

## Step 6: Add Player Events

### 6.1 Login/Logout Events

In your login function (usually in `comm.c` or `interpreter.c`):

```c
/* When player successfully logs in */
imc_player_login(d->character);
```

In your logout function:

```c
/* When player logs out */
imc_player_logout(ch);
```


### 6.3 Idle Events

In your idle checking code (usually in `limits.c`):

```c
/* When updating player idle time */
imc_player_idle(ch, ch->char_specials.timer);
```

## Step 7: Register Your MUD

Before connecting, you need to register your MUD with the MudVault Mesh network:

```bash
curl -X POST https://mudvault.org/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "mudName": "YourUniqueMUDName",
    "adminEmail": "admin@yourmud.com"
  }'
```

The response will include your API key. Add it to `imc_config.h`:

```c
#define IMC_API_KEY "your-actual-api-key-here"
```

## Step 8: Compile

Compile your MUD as usual:

```bash
cd /path/to/your/mud/src
make clean
make
```

If you get compilation errors, check:
- OpenSSL development libraries are installed
- All MudVault Mesh files are in the src directory
- Makefile includes the MudVault Mesh objects and libraries
- Your MUD type is correctly defined in `imc_config.h`

## Step 9: Test

Start your MUD and test the integration:

1. **Check Status**: Use `imcstats` to see connection status
2. **List MUDs**: Use `imclist` to see connected MUDs
3. **Test Tell**: Use `imctell player@othermud Hello!`
4. **Test Channel**: Use `chjoin gossip` then `channel gossip Hello everyone!`

## Troubleshooting

### Common Issues

1. **Compilation Errors**
   ```
   error: openssl/sha.h: No such file or directory
   ```
   **Solution**: Install OpenSSL development libraries

2. **Connection Failed**
   ```
   IMC: Failed to connect to gateway
   ```
   **Solution**: Check your internet connection and firewall settings

3. **Authentication Failed**
   ```
   IMC: Authentication failed
   ```
   **Solution**: Verify your API key and MUD name are correct

4. **Command Not Found**
   ```
   Huh?!?
   ```
   **Solution**: Make sure commands are added to your command table

### Debug Mode

Enable debug logging by setting in `imc_config.h`:

```c
#define IMC_DEBUG 1
```

This will show all IMC messages in your logs.

### Log Messages

Watch your MUD logs for these messages:
- `MudVault Mesh starting up...` - Mesh is initializing
- `Connected to MudVault Mesh gateway` - Successfully connected
- `MudVault Mesh: Player John logged in` - Player events working

## Performance Impact

The MudVault Mesh integration has minimal performance impact:
- CPU usage: <0.1% on typical MUDs
- Memory usage: ~50KB base + ~1KB per connected MUD
- Network usage: ~1KB/minute for idle MUD

## Support

If you need help:
- Check the [main documentation](../docs/)
- Visit our [Discord](https://discord.gg/r6kM56YrEV)
- Email: asmodeusbrooding@gmail.com
- GitHub issues: https://github.com/Coffee-Nerd/OpenIMC/issues

## Advanced Configuration

### Custom Channels

To create MUD-specific channels on startup, add to your initialization:

```c
/* In your init function, after imc_startup() */
if (IMC_IS_CONNECTED()) {
    imc_create_channel("newbie", "Newbie help channel", FALSE);
    imc_create_channel("admin", "Admin channel", TRUE);
}
```

### Message Filtering

To add content filtering, modify the `imc_filter_message()` function in `openimc.c`:

```c
bool imc_filter_message(char *message) {
    /* Add your filtering logic here */
    if (strstr(message, "inappropriate_word"))
        return FALSE;
    return TRUE;
}
```

### Rate Limit Adjustment

Adjust rate limits in `imc_config.h` if needed:

```c
#define IMC_MAX_TELLS_MIN      30    /* Increase if players complain */
#define IMC_MAX_CHANNELS_MIN   50    /* Increase for busy channels */
```

## Congratulations!

Your MUD is now connected to the MudVault Mesh network! Players can communicate with other MUDs using the commands listed in the help system (`imchelp`).