/*
 * OpenIMC Header File for DikuMUD/Merc Integration
 * 
 * This file contains all the structures, defines, and function declarations
 * needed to integrate OpenIMC with your DikuMUD-based MUD.
 */

#ifndef OPENIMC_H
#define OPENIMC_H

#include "imc_config.h"

/* Standard includes */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>
#include <errno.h>
#include <time.h>
#include <sys/time.h>
#include <fcntl.h>

/* JSON library - you may need to install/link a JSON library */
/* For this example, we'll use a simple JSON implementation */
#include "json.h"  /* You'll need to provide this or use cJSON */

/* =================================================================== */
/* STRUCTURES AND TYPEDEFS                                            */
/* =================================================================== */

/* IMC connection states */
typedef enum {
    IMC_DISCONNECTED = 0,
    IMC_CONNECTING,
    IMC_CONNECTED,
    IMC_AUTHENTICATING,
    IMC_AUTHENTICATED,
    IMC_ERROR
} imc_state_t;

/* IMC message types */
typedef enum {
    IMC_MSG_TELL = 0,
    IMC_MSG_EMOTE,
    IMC_MSG_EMOTETO,
    IMC_MSG_CHANNEL,
    IMC_MSG_WHO,
    IMC_MSG_FINGER,
    IMC_MSG_LOCATE,
    IMC_MSG_PRESENCE,
    IMC_MSG_AUTH,
    IMC_MSG_PING,
    IMC_MSG_PONG,
    IMC_MSG_ERROR,
    IMC_MSG_UNKNOWN
} imc_msg_type_t;

/* Channel actions */
typedef enum {
    IMC_CHAN_MESSAGE = 0,
    IMC_CHAN_JOIN,
    IMC_CHAN_LEAVE,
    IMC_CHAN_LIST
} imc_chan_action_t;

/* User information structure */
typedef struct imc_user_info {
    char username[IMC_MAX_USERNAME_LEN];
    char displayName[IMC_MAX_USERNAME_LEN];
    char realName[64];
    char email[128];
    char plan[256];
    int level;
    int idleTime;
    char location[128];
    char race[32];
    char class[32];
    char guild[64];
    time_t lastLogin;
    struct imc_user_info *next;
} IMC_USER_INFO;

/* Channel member structure */
typedef struct imc_channel_member {
    char username[IMC_MAX_USERNAME_LEN];
    char mudname[IMC_MAX_USERNAME_LEN];
    struct imc_channel_member *next;
} IMC_CHANNEL_MEMBER;

/* Channel structure */
typedef struct imc_channel {
    char name[IMC_MAX_CHANNEL_LEN];
    char description[256];
    bool joined;
    bool moderated;
    IMC_CHANNEL_MEMBER *members;
    struct imc_channel *next;
} IMC_CHANNEL;

/* Message history entry */
typedef struct imc_history {
    char message[IMC_MAX_MESSAGE_LEN];
    char from[IMC_MAX_USERNAME_LEN];
    char to[IMC_MAX_USERNAME_LEN];
    time_t timestamp;
    imc_msg_type_t type;
    struct imc_history *next;
} IMC_HISTORY;

/* Connected MUD information */
typedef struct imc_mud_info {
    char name[IMC_MAX_USERNAME_LEN];
    char host[128];
    int port;
    char version[32];
    char admin[64];
    char email[128];
    int users;
    int maxUsers;
    time_t uptime;
    struct imc_mud_info *next;
} IMC_MUD_INFO;

/* Main IMC data structure */
typedef struct imc_data {
    int socket;                     /* WebSocket connection */
    imc_state_t state;             /* Connection state */
    char buffer[IMC_BUFFER_SIZE];  /* Input buffer */
    int buflen;                    /* Buffer length */
    time_t last_ping;              /* Last ping sent */
    time_t last_pong;              /* Last pong received */
    time_t connect_time;           /* When we connected */
    int reconnect_attempts;        /* Reconnection attempts */
    IMC_CHANNEL *channels;         /* Channel list */
    IMC_MUD_INFO *muds;           /* Connected MUDs */
    IMC_HISTORY *history;         /* Message history */
    IMC_USER_INFO *users;         /* Cached user info */
} IMC_DATA;

/* =================================================================== */
/* GLOBAL VARIABLES                                                   */
/* =================================================================== */

extern IMC_DATA *imc_data;
extern bool imc_active;

/* =================================================================== */
/* FUNCTION DECLARATIONS                                              */
/* =================================================================== */

/* Core IMC functions */
int  imc_startup(void);
void imc_shutdown(void);
void imc_loop(void);
bool imc_is_connected(void);

/* Connection management */
int  imc_connect(void);
void imc_disconnect(void);
void imc_reconnect(void);
bool imc_authenticate(void);

/* Message handling */
void imc_process_input(void);
void imc_send_message(const char *json);
bool imc_parse_message(const char *json);
void imc_handle_message(imc_msg_type_t type, const char *from_mud, 
                       const char *from_user, const char *to_mud, 
                       const char *to_user, const char *payload);

/* Message creation */
char *imc_create_tell(const char *from_user, const char *to_mud, 
                     const char *to_user, const char *message);
char *imc_create_emote(const char *from_user, const char *to_mud, 
                      const char *action);
char *imc_create_emoteto(const char *from_user, const char *to_mud, 
                        const char *to_user, const char *action);
char *imc_create_channel_msg(const char *from_user, const char *channel, 
                            const char *message, imc_chan_action_t action);
char *imc_create_who_request(const char *to_mud);
char *imc_create_finger_request(const char *to_mud, const char *to_user);
char *imc_create_locate_request(const char *username);
char *imc_create_presence(const char *username, const char *status, 
                         const char *location);
char *imc_create_auth(void);
char *imc_create_ping(void);
char *imc_create_pong(long timestamp);

/* Message sending functions */
void imc_send_tell(const char *from_user, const char *to_mud, 
                  const char *to_user, const char *message);
void imc_send_emote(const char *from_user, const char *to_mud, 
                   const char *action);
void imc_send_emoteto(const char *from_user, const char *to_mud, 
                     const char *to_user, const char *action);
void imc_send_channel_message(const char *from_user, const char *channel, 
                             const char *message);
void imc_send_who_request(const char *to_mud);
void imc_send_finger_request(const char *to_mud, const char *to_user);
void imc_send_locate_request(const char *username);
void imc_send_presence_update(const char *username, const char *status, 
                             const char *location);

/* Channel management */
IMC_CHANNEL *imc_find_channel(const char *name);
IMC_CHANNEL *imc_create_channel(const char *name, const char *description, 
                               bool moderated);
void imc_join_channel(const char *channel, const char *username);
void imc_leave_channel(const char *channel, const char *username);
void imc_list_channels(CHAR_DATA *ch);
bool imc_is_on_channel(const char *channel, const char *username);

/* User management */
IMC_USER_INFO *imc_find_user(const char *username, const char *mudname);
IMC_USER_INFO *imc_create_user_info(const char *username, const char *mudname);
void imc_update_user_info(const char *username, const char *mudname, 
                         CHAR_DATA *ch);
void imc_remove_user_info(const char *username, const char *mudname);

/* MUD information */
IMC_MUD_INFO *imc_find_mud(const char *mudname);
IMC_MUD_INFO *imc_create_mud_info(const char *mudname);
void imc_update_mud_info(const char *mudname, const char *host, int port, 
                        const char *version, int users);
void imc_list_muds(CHAR_DATA *ch);

/* History management */
void imc_add_history(imc_msg_type_t type, const char *from, const char *to, 
                    const char *message);
void imc_show_history(CHAR_DATA *ch, imc_msg_type_t type, int count);
void imc_clear_history(void);

/* Player integration functions */
void imc_player_login(CHAR_DATA *ch);
void imc_player_logout(CHAR_DATA *ch);
void imc_player_idle(CHAR_DATA *ch, int idle_time);
void imc_player_levelup(CHAR_DATA *ch, int old_level, int new_level);

/* Utility functions */
char *imc_generate_uuid(void);
char *imc_get_timestamp(void);
bool imc_validate_mudname(const char *mudname);
bool imc_validate_username(const char *username);
bool imc_validate_channel(const char *channel);
char *imc_escape_json(const char *str);
char *imc_unescape_json(const char *str);
void imc_log(const char *fmt, ...);
void imc_debug(const char *fmt, ...);

/* WebSocket functions */
int  imc_websocket_connect(const char *host, int port);
bool imc_websocket_handshake(int sock, const char *host, int port);
int  imc_websocket_send(int sock, const char *data);
int  imc_websocket_recv(int sock, char *buffer, int bufsize);
void imc_websocket_close(int sock);

/* JSON utility functions */
char *imc_json_get_string(const char *json, const char *key);
int   imc_json_get_int(const char *json, const char *key);
bool  imc_json_get_bool(const char *json, const char *key);
char *imc_json_create_object(void);
void  imc_json_add_string(char **json, const char *key, const char *value);
void  imc_json_add_int(char **json, const char *key, int value);
void  imc_json_add_bool(char **json, const char *key, bool value);
void  imc_json_add_object(char **json, const char *key, const char *object);
char *imc_json_finalize(char *json);

/* Rate limiting */
bool imc_check_rate_limit(const char *type, const char *identifier);
void imc_reset_rate_limits(void);

/* Configuration */
void imc_load_config(void);
void imc_save_config(void);

/* =================================================================== */
/* COMMAND FUNCTION DECLARATIONS                                      */
/* =================================================================== */

/* These functions should be added to your command table */
/* Use the appropriate declaration style for your MUD type */

/* For CircleMUD */
#ifdef CIRCLE_MUD
ACMD(do_imctell);
ACMD(do_imcemote);
ACMD(do_imcemoteto);
ACMD(do_imcwho);
ACMD(do_imcfinger);
ACMD(do_imclocate);
ACMD(do_imclist);
ACMD(do_imcstats);
ACMD(do_imchistory);
ACMD(do_channels);
ACMD(do_channel);
ACMD(do_chjoin);
ACMD(do_chleave);
ACMD(do_chwho);
ACMD(do_imchelp);
ACMD(do_imcadmin);
ACMD(do_imcreconnect);
ACMD(do_imcdebug);
#else
/* For Merc/ROM/Smaug and other codebases */
DO_FUN(do_imctell);
DO_FUN(do_imcemote);
DO_FUN(do_imcemoteto);
DO_FUN(do_imcwho);
DO_FUN(do_imcfinger);
DO_FUN(do_imclocate);
DO_FUN(do_imclist);
DO_FUN(do_imcstats);
DO_FUN(do_imchistory);
DO_FUN(do_channels);
DO_FUN(do_channel);
DO_FUN(do_chjoin);
DO_FUN(do_chleave);
DO_FUN(do_chwho);
DO_FUN(do_imchelp);
DO_FUN(do_imcadmin);
DO_FUN(do_imcreconnect);
DO_FUN(do_imcdebug);
#endif

/* =================================================================== */
/* MACROS AND CONVENIENCE FUNCTIONS                                   */
/* =================================================================== */

#define IMC_IS_CONNECTED()     (imc_data && imc_data->state == IMC_AUTHENTICATED)
#define IMC_GET_STATE()        (imc_data ? imc_data->state : IMC_DISCONNECTED)
#define IMC_UPTIME()           (imc_data ? time(NULL) - imc_data->connect_time : 0)

/* Color macros for messages */
#define IMC_SEND_COLOR(ch, color, msg) \
    do { \
        if (PRF_FLAGGED(ch, PRF_COLOR_1) || PRF_FLAGGED(ch, PRF_COLOR_2)) \
            imc_send_to_char(ch, color msg IMC_COLOR_NORMAL); \
        else \
            imc_send_to_char(ch, msg); \
    } while(0)

/* Convenience macros for common operations */
#define IMC_SEND_TELL_COLOR(ch, msg) IMC_SEND_COLOR(ch, IMC_COLOR_TELL, msg)
#define IMC_SEND_CHANNEL_COLOR(ch, msg) IMC_SEND_COLOR(ch, IMC_COLOR_CHANNEL, msg)
#define IMC_SEND_EMOTE_COLOR(ch, msg) IMC_SEND_COLOR(ch, IMC_COLOR_EMOTE, msg)
#define IMC_SEND_INFO_COLOR(ch, msg) IMC_SEND_COLOR(ch, IMC_COLOR_INFO, msg)
#define IMC_SEND_ERROR_COLOR(ch, msg) IMC_SEND_COLOR(ch, IMC_COLOR_ERROR, msg)

/* Permission checking macros */
#define IMC_CAN_USE_TELL(ch)    (imc_get_level(ch) >= IMC_MIN_LEVEL_TELL)
#define IMC_CAN_USE_CHANNEL(ch) (imc_get_level(ch) >= IMC_MIN_LEVEL_CHANNEL)
#define IMC_CAN_USE_WHO(ch)     (imc_get_level(ch) >= IMC_MIN_LEVEL_WHO)
#define IMC_CAN_USE_FINGER(ch)  (imc_get_level(ch) >= IMC_MIN_LEVEL_FINGER)

/* String manipulation macros */
#define IMC_SKIP_SPACES(str)    while (*(str) == ' ') (str)++
#define IMC_REMOVE_BIT(var, bit) ((var) &= ~(bit))
#define IMC_SET_BIT(var, bit)   ((var) |= (bit))
#define IMC_IS_SET(var, bit)    ((var) & (bit))

/* Memory management macros */
#define IMC_CREATE(type)        ((type *) calloc(1, sizeof(type)))
#define IMC_FREE(ptr)           do { if (ptr) { free(ptr); ptr = NULL; } } while(0)
#define IMC_STRDUP(str)         ((str) ? strdup(str) : NULL)

/* Validation macros */
#define IMC_VALID_MUDNAME(str)  (imc_validate_mudname(str))
#define IMC_VALID_USERNAME(str) (imc_validate_username(str))
#define IMC_VALID_CHANNEL(str)  (imc_validate_channel(str))

/* =================================================================== */
/* ERROR CODES                                                        */
/* =================================================================== */

#define IMC_ERR_NONE            0
#define IMC_ERR_NO_CONNECTION   -1
#define IMC_ERR_AUTH_FAILED     -2
#define IMC_ERR_INVALID_MSG     -3
#define IMC_ERR_RATE_LIMITED    -4
#define IMC_ERR_USER_NOT_FOUND  -5
#define IMC_ERR_MUD_NOT_FOUND   -6
#define IMC_ERR_CHANNEL_ERROR   -7
#define IMC_ERR_PERMISSION      -8
#define IMC_ERR_NETWORK         -9
#define IMC_ERR_MEMORY          -10

#endif /* OPENIMC_H */