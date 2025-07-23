/*
 * MudVault Mesh Configuration for DikuMUD/Merc
 * 
 * Configure these settings for your MUD before compiling
 */

#ifndef IMC_CONFIG_H
#define IMC_CONFIG_H

/* =================================================================== */
/* REQUIRED SETTINGS - You MUST configure these                       */
/* =================================================================== */

/* Your MUD's unique name - MUST be unique across the network */
#define IMC_MUD_NAME        "YourMUDName"

/* MudVault Mesh Gateway connection settings */
#define IMC_GATEWAY_HOST    "mesh.mudvault.org" /* MudVault Mesh gateway */
#define IMC_GATEWAY_PORT    8081                /* WebSocket port */

/* Your API key - get this from registering your MUD with MudVault Mesh */
#define IMC_API_KEY         "your-api-key-here"

/* Your MUD admin email for registration */
#define IMC_ADMIN_EMAIL     "admin@yourmud.com"

/* =================================================================== */
/* OPTIONAL SETTINGS - Defaults should work for most MUDs             */
/* =================================================================== */

/* Connection settings */
#define IMC_RECONNECT_DELAY    30              /* Seconds between reconnect attempts */
#define IMC_MAX_RECONNECTS     10              /* Max reconnection attempts */
#define IMC_PING_INTERVAL      60              /* Heartbeat interval in seconds */
#define IMC_TIMEOUT            30              /* Connection timeout in seconds */

/* Buffer sizes */
#define IMC_MAX_MESSAGE_LEN    4096            /* Maximum message length */
#define IMC_MAX_CHANNEL_LEN    32              /* Maximum channel name length */
#define IMC_MAX_USERNAME_LEN   32              /* Maximum username length */
#define IMC_BUFFER_SIZE        8192            /* Network buffer size */

/* Debug and logging */
#define IMC_DEBUG              0               /* 1 = Enable debug logging */
#define IMC_LOG_FILE           "../log/imc.log" /* Log file path */

/* Message history */
#define IMC_HISTORY_SIZE       100             /* Messages to keep in history */
#define IMC_CHANNEL_HISTORY    50              /* Channel messages to keep */

/* Rate limiting - be conservative to avoid being rate limited */
#define IMC_MAX_TELLS_MIN      20              /* Max tells per minute */
#define IMC_MAX_CHANNELS_MIN   30              /* Max channel messages per minute */
#define IMC_MAX_WHO_MIN        5               /* Max who requests per minute */

/* Channel settings */
#define IMC_MAX_CHANNELS       20              /* Max channels a player can join */
#define IMC_DEFAULT_CHANNELS   { "gossip", "newbie", "ooc" }  /* Auto-join channels */

/* Player settings */
#define IMC_MIN_LEVEL_TELL     1               /* Minimum level to use imctell */
#define IMC_MIN_LEVEL_CHANNEL  1               /* Minimum level for channels */
#define IMC_MIN_LEVEL_WHO      1               /* Minimum level to use imcwho */
#define IMC_MIN_LEVEL_FINGER   5               /* Minimum level to use imcfinger */

/* Security settings */
#define IMC_ALLOW_GUESTS       0               /* Allow guest accounts to use IMC */
#define IMC_FILTER_PROFANITY   1               /* Enable basic profanity filtering */
#define IMC_LOG_ALL_MESSAGES   0               /* Log all IMC messages (privacy!) */

/* =================================================================== */
/* ADVANCED SETTINGS - Only change if you know what you're doing      */
/* =================================================================== */

/* Protocol settings */
#define IMC_PROTOCOL_VERSION   "1.0"
#define IMC_CLIENT_VERSION     "DikuMUD-1.0"

/* JSON message settings */
#define IMC_MESSAGE_TTL        300             /* Message time-to-live in seconds */
#define IMC_MESSAGE_PRIORITY   5               /* Default message priority (1-10) */

/* Connection retry settings */
#define IMC_RETRY_BACKOFF      2               /* Exponential backoff multiplier */
#define IMC_MAX_RETRY_DELAY    300             /* Maximum retry delay in seconds */

/* Memory management */
#define IMC_MAX_CACHED_USERS   1000            /* Max users to cache info for */
#define IMC_CACHE_TIMEOUT      3600            /* Cache timeout in seconds */

/* =================================================================== */
/* FEATURE TOGGLES - Enable/disable specific features                 */
/* =================================================================== */

#define IMC_ENABLE_TELLS       1               /* Enable inter-MUD tells via MudVault Mesh */
#define IMC_ENABLE_CHANNELS    1               /* Enable channel chat */
#define IMC_ENABLE_WHO         1               /* Enable who lists */
#define IMC_ENABLE_FINGER      1               /* Enable finger info */
#define IMC_ENABLE_LOCATE      1               /* Enable user location */
#define IMC_ENABLE_EMOTES      1               /* Enable inter-MUD emotes via MudVault Mesh */
#define IMC_ENABLE_BEEP        1               /* Enable beep/page */
#define IMC_ENABLE_FILE        0               /* Enable file transfers (future) */
#define IMC_ENABLE_MAIL        0               /* Enable inter-MUD mail via MudVault Mesh (future) */

/* Channel features */
#define IMC_ENABLE_CHAN_WHO    1               /* Enable channel who lists */
#define IMC_ENABLE_CHAN_HISTORY 1              /* Enable channel history */
#define IMC_ENABLE_CHAN_MODERATE 1             /* Enable channel moderation */

/* =================================================================== */
/* COMPATIBILITY SETTINGS - For different MUD codebases               */
/* =================================================================== */

/* Uncomment ONE of these based on your MUD type */
/* #define CIRCLE_MUD      1 */
/* #define DIKUMUD         1 */
/* #define MERC            1 */
/* #define ROM             1 */
/* #define SMAUG           1 */
/* #define IMC2_COMPAT     1 */     /* Enable IMC2 compatibility mode */

/* Function name mappings for different codebases */
#ifdef CIRCLE_MUD
#define imc_log(str)           log("IMC: %s", str)
#define imc_send_to_char(ch, str) send_to_char(ch, "%s", str)
#define imc_get_name(ch)       GET_NAME(ch)
#define imc_get_level(ch)      GET_LEVEL(ch)
#define imc_get_room_vnum(ch)  GET_ROOM_VNUM(IN_ROOM(ch))
#endif

#ifdef MERC
#define imc_log(str)           bug("IMC: %s", str)
#define imc_send_to_char(ch, str) send_to_char(str, ch)
#define imc_get_name(ch)       ch->name
#define imc_get_level(ch)      ch->level
#define imc_get_room_vnum(ch)  ch->in_room->vnum
#endif

#ifdef ROM
#define imc_log(str)           bug("IMC: %s", str)
#define imc_send_to_char(ch, str) send_to_char(str, ch)
#define imc_get_name(ch)       ch->name
#define imc_get_level(ch)      ch->level
#define imc_get_room_vnum(ch)  ch->in_room->vnum
#endif

/* Default mappings if none specified */
#ifndef imc_log
#define imc_log(str)           fprintf(stderr, "IMC: %s\n", str)
#endif

#ifndef imc_send_to_char
#define imc_send_to_char(ch, str) send_to_char(str, ch)
#endif

#ifndef imc_get_name
#define imc_get_name(ch)       (ch)->name
#endif

#ifndef imc_get_level
#define imc_get_level(ch)      (ch)->level
#endif

#ifndef imc_get_room_vnum
#define imc_get_room_vnum(ch)  0
#endif

/* =================================================================== */
/* COLOR CODE SETTINGS - ANSI color support                          */
/* =================================================================== */

#define IMC_ENABLE_COLOR       1               /* Enable ANSI color codes */

#ifdef IMC_ENABLE_COLOR
#define IMC_COLOR_TELL         "\033[1;36m"    /* Cyan for tells */
#define IMC_COLOR_CHANNEL      "\033[1;33m"    /* Yellow for channels */
#define IMC_COLOR_EMOTE        "\033[1;35m"    /* Magenta for emotes */
#define IMC_COLOR_INFO         "\033[1;32m"    /* Green for info */
#define IMC_COLOR_ERROR        "\033[1;31m"    /* Red for errors */
#define IMC_COLOR_NORMAL       "\033[0m"       /* Reset to normal */
#else
#define IMC_COLOR_TELL         ""
#define IMC_COLOR_CHANNEL      ""
#define IMC_COLOR_EMOTE        ""
#define IMC_COLOR_INFO         ""
#define IMC_COLOR_ERROR        ""
#define IMC_COLOR_NORMAL       ""
#endif

/* =================================================================== */
/* VALIDATION - Don't edit below this line                            */
/* =================================================================== */

#if !defined(IMC_MUD_NAME) || !defined(IMC_GATEWAY_HOST) || !defined(IMC_API_KEY)
#error "You must configure IMC_MUD_NAME, IMC_GATEWAY_HOST, and IMC_API_KEY for MudVault Mesh"
#endif

#if IMC_MAX_MESSAGE_LEN > 4096
#error "IMC_MAX_MESSAGE_LEN cannot exceed 4096 bytes"
#endif

#if IMC_PING_INTERVAL < 30
#error "IMC_PING_INTERVAL must be at least 30 seconds"
#endif

#endif /* IMC_CONFIG_H */