/*
 * MudVault Mesh Core Implementation for DikuMUD/Merc
 * 
 * This file contains the core MudVault Mesh functionality for connecting
 * your DikuMUD-based MUD to the MudVault Mesh network.
 * 
 * Author: MudVault Mesh Development Team
 * License: MIT
 */

#include "sysdep.h"
#include "structs.h"
#include "utils.h"
#include "comm.h"
#include "interpreter.h"
#include "handler.h"
#include "db.h"
#include "mudvault_mesh.h"

/* Global IMC data */
IMC_DATA *imc_data = NULL;
bool imc_active = FALSE;

/* Rate limiting data */
static time_t last_tell_time = 0;
static time_t last_channel_time = 0;
static time_t last_who_time = 0;
static int tells_this_minute = 0;
static int channels_this_minute = 0;
static int who_this_minute = 0;

/* =================================================================== */
/* CORE FUNCTIONS                                                     */
/* =================================================================== */

/*
 * Initialize the MudVault Mesh system
 */
int imc_startup(void) {
    imc_log("MudVault Mesh starting up...");
    
    /* Allocate main data structure */
    imc_data = IMC_CREATE(IMC_DATA);
    if (!imc_data) {
        imc_log("ERROR: Could not allocate IMC data structure");
        return IMC_ERR_MEMORY;
    }
    
    /* Initialize data */
    imc_data->socket = -1;
    imc_data->state = IMC_DISCONNECTED;
    imc_data->buflen = 0;
    imc_data->last_ping = 0;
    imc_data->last_pong = 0;
    imc_data->connect_time = 0;
    imc_data->reconnect_attempts = 0;
    imc_data->channels = NULL;
    imc_data->muds = NULL;
    imc_data->history = NULL;
    imc_data->users = NULL;
    
    /* Load configuration */
    imc_load_config();
    
    /* Attempt initial connection */
    if (imc_connect() < 0) {
        imc_log("Initial connection failed, will retry later");
    }
    
    imc_active = TRUE;
    imc_log("MudVault Mesh startup complete");
    return IMC_ERR_NONE;
}

/*
 * Shutdown the MudVault Mesh system
 */
void imc_shutdown(void) {
    if (!imc_data) return;
    
    imc_log("MudVault Mesh shutting down...");
    imc_active = FALSE;
    
    /* Disconnect from gateway */
    imc_disconnect();
    
    /* Free all allocated memory */
    /* TODO: Implement proper cleanup of all linked lists */
    
    IMC_FREE(imc_data);
    imc_log("MudVault Mesh shutdown complete");
}

/*
 * Main loop function - call this from your MUD's main loop
 */
void imc_loop(void) {
    static time_t last_loop = 0;
    time_t now = time(NULL);
    
    if (!imc_active || !imc_data) return;
    
    /* Don't run more than once per second */
    if (now == last_loop) return;
    last_loop = now;
    
    /* Handle connection state */
    switch (imc_data->state) {
        case IMC_DISCONNECTED:
            /* Try to reconnect */
            if (now - imc_data->connect_time > IMC_RECONNECT_DELAY) {
                imc_reconnect();
            }
            break;
            
        case IMC_CONNECTING:
        case IMC_AUTHENTICATING:
            /* Check for timeout */
            if (now - imc_data->connect_time > IMC_TIMEOUT) {
                imc_log("Connection timeout");
                imc_disconnect();
            }
            break;
            
        case IMC_AUTHENTICATED:
            /* Process incoming data */
            imc_process_input();
            
            /* Send periodic ping */
            if (now - imc_data->last_ping > IMC_PING_INTERVAL) {
                char *ping = imc_create_ping();
                if (ping) {
                    imc_send_message(ping);
                    free(ping);
                    imc_data->last_ping = now;
                }
            }
            
            /* Check for pong timeout */
            if (imc_data->last_pong > 0 && 
                now - imc_data->last_pong > IMC_PING_INTERVAL * 2) {
                imc_log("Ping timeout, reconnecting");
                imc_disconnect();
            }
            break;
            
        default:
            break;
    }
    
    /* Reset rate limiting counters */
    static time_t last_rate_reset = 0;
    if (now - last_rate_reset >= 60) {
        imc_reset_rate_limits();
        last_rate_reset = now;
    }
}

/*
 * Check if we're connected and authenticated
 */
bool imc_is_connected(void) {
    return (imc_data && imc_data->state == IMC_AUTHENTICATED);
}

/* =================================================================== */
/* CONNECTION MANAGEMENT                                              */
/* =================================================================== */

/*
 * Connect to the MudVault Mesh gateway
 */
int imc_connect(void) {
    if (!imc_data) return IMC_ERR_NO_CONNECTION;
    
    imc_log("Connecting to %s:%d", IMC_GATEWAY_HOST, IMC_GATEWAY_PORT);
    
    /* Close existing connection */
    if (imc_data->socket >= 0) {
        close(imc_data->socket);
    }
    
    /* Connect to gateway */
    imc_data->socket = imc_websocket_connect(IMC_GATEWAY_HOST, IMC_GATEWAY_PORT);
    if (imc_data->socket < 0) {
        imc_log("Failed to connect to gateway");
        imc_data->state = IMC_DISCONNECTED;
        return IMC_ERR_NETWORK;
    }
    
    /* Perform WebSocket handshake */
    if (!imc_websocket_handshake(imc_data->socket, IMC_GATEWAY_HOST, IMC_GATEWAY_PORT)) {
        imc_log("WebSocket handshake failed");
        close(imc_data->socket);
        imc_data->socket = -1;
        imc_data->state = IMC_DISCONNECTED;
        return IMC_ERR_NETWORK;
    }
    
    imc_data->state = IMC_CONNECTED;
    imc_data->connect_time = time(NULL);
    imc_data->buflen = 0;
    
    /* Send authentication message */
    if (!imc_authenticate()) {
        imc_log("Authentication failed");
        imc_disconnect();
        return IMC_ERR_AUTH_FAILED;
    }
    
    imc_log("Connected to MudVault Mesh gateway");
    return IMC_ERR_NONE;
}

/*
 * Disconnect from the gateway
 */
void imc_disconnect(void) {
    if (!imc_data) return;
    
    if (imc_data->socket >= 0) {
        close(imc_data->socket);
        imc_data->socket = -1;
    }
    
    imc_data->state = IMC_DISCONNECTED;
    imc_data->buflen = 0;
    imc_data->connect_time = time(NULL);
    
    imc_log("Disconnected from MudVault Mesh gateway");
}

/*
 * Attempt to reconnect
 */
void imc_reconnect(void) {
    if (!imc_data) return;
    
    imc_data->reconnect_attempts++;
    
    if (imc_data->reconnect_attempts > IMC_MAX_RECONNECTS) {
        imc_log("Maximum reconnection attempts reached, giving up");
        return;
    }
    
    imc_log("Reconnection attempt %d/%d", 
            imc_data->reconnect_attempts, IMC_MAX_RECONNECTS);
    
    if (imc_connect() >= 0) {
        imc_data->reconnect_attempts = 0;
    }
}

/*
 * Send authentication message
 */
bool imc_authenticate(void) {
    char *auth_msg;
    
    if (!imc_data || imc_data->socket < 0) return FALSE;
    
    auth_msg = imc_create_auth();
    if (!auth_msg) return FALSE;
    
    imc_send_message(auth_msg);
    free(auth_msg);
    
    imc_data->state = IMC_AUTHENTICATING;
    return TRUE;
}

/* =================================================================== */
/* MESSAGE HANDLING                                                   */
/* =================================================================== */

/*
 * Process incoming data from the gateway
 */
void imc_process_input(void) {
    char *line_start, *line_end;
    int bytes_read;
    
    if (!imc_data || imc_data->socket < 0) return;
    
    /* Read available data */
    bytes_read = imc_websocket_recv(imc_data->socket, 
                                   imc_data->buffer + imc_data->buflen,
                                   IMC_BUFFER_SIZE - imc_data->buflen - 1);
    
    if (bytes_read <= 0) {
        if (bytes_read < 0 && errno != EAGAIN && errno != EWOULDBLOCK) {
            imc_log("Socket error: %s", strerror(errno));
            imc_disconnect();
        }
        return;
    }
    
    imc_data->buflen += bytes_read;
    imc_data->buffer[imc_data->buflen] = '\0';
    
    /* Process complete messages */
    line_start = imc_data->buffer;
    while ((line_end = strchr(line_start, '\n')) != NULL) {
        *line_end = '\0';
        
        /* Parse and handle the message */
        if (strlen(line_start) > 0) {
            imc_parse_message(line_start);
        }
        
        line_start = line_end + 1;
    }
    
    /* Move remaining data to start of buffer */
    if (line_start > imc_data->buffer) {
        int remaining = imc_data->buflen - (line_start - imc_data->buffer);
        if (remaining > 0) {
            memmove(imc_data->buffer, line_start, remaining);
        }
        imc_data->buflen = remaining;
        imc_data->buffer[imc_data->buflen] = '\0';
    }
}

/*
 * Send a message to the gateway
 */
void imc_send_message(const char *json) {
    if (!imc_data || imc_data->socket < 0 || !json) return;
    
    if (imc_websocket_send(imc_data->socket, json) < 0) {
        imc_log("Failed to send message");
        imc_disconnect();
    }
    
#if IMC_DEBUG
    imc_debug("SENT: %s", json);
#endif
}

/*
 * Parse an incoming JSON message
 */
bool imc_parse_message(const char *json) {
    char *type_str, *from_mud, *from_user, *to_mud, *to_user;
    imc_msg_type_t type;
    
    if (!json || strlen(json) == 0) return FALSE;
    
#if IMC_DEBUG
    imc_debug("RECV: %s", json);
#endif
    
    /* Extract message type */
    type_str = imc_json_get_string(json, "type");
    if (!type_str) {
        imc_log("Message missing type field");
        return FALSE;
    }
    
    /* Convert type string to enum */
    if (strcmp(type_str, "tell") == 0) type = IMC_MSG_TELL;
    else if (strcmp(type_str, "emote") == 0) type = IMC_MSG_EMOTE;
    else if (strcmp(type_str, "emoteto") == 0) type = IMC_MSG_EMOTETO;
    else if (strcmp(type_str, "channel") == 0) type = IMC_MSG_CHANNEL;
    else if (strcmp(type_str, "who") == 0) type = IMC_MSG_WHO;
    else if (strcmp(type_str, "finger") == 0) type = IMC_MSG_FINGER;
    else if (strcmp(type_str, "locate") == 0) type = IMC_MSG_LOCATE;
    else if (strcmp(type_str, "presence") == 0) type = IMC_MSG_PRESENCE;
    else if (strcmp(type_str, "auth") == 0) type = IMC_MSG_AUTH;
    else if (strcmp(type_str, "ping") == 0) type = IMC_MSG_PING;
    else if (strcmp(type_str, "pong") == 0) type = IMC_MSG_PONG;
    else if (strcmp(type_str, "error") == 0) type = IMC_MSG_ERROR;
    else {
        imc_log("Unknown message type: %s", type_str);
        free(type_str);
        return FALSE;
    }
    free(type_str);
    
    /* Extract routing information */
    from_mud = imc_json_get_string(json, "from.mud");
    from_user = imc_json_get_string(json, "from.user");
    to_mud = imc_json_get_string(json, "to.mud");
    to_user = imc_json_get_string(json, "to.user");
    
    /* Handle the message */
    imc_handle_message(type, from_mud, from_user, to_mud, to_user, json);
    
    /* Cleanup */
    if (from_mud) free(from_mud);
    if (from_user) free(from_user);
    if (to_mud) free(to_mud);
    if (to_user) free(to_user);
    
    return TRUE;
}

/*
 * Handle a parsed message
 */
void imc_handle_message(imc_msg_type_t type, const char *from_mud, 
                       const char *from_user, const char *to_mud, 
                       const char *to_user, const char *payload) {
    CHAR_DATA *ch;
    char *message, *channel, *action;
    
    switch (type) {
        case IMC_MSG_TELL:
            /* Handle incoming tell */
            message = imc_json_get_string(payload, "payload.message");
            if (message && to_user) {
                ch = get_char_vis_world(to_user);
                if (ch) {
                    IMC_SEND_TELL_COLOR(ch, sprintf(buf, 
                        "%s@%s tells you: %s\r\n", 
                        from_user ? from_user : "Someone", 
                        from_mud ? from_mud : "Unknown", 
                        message));
                    imc_add_history(IMC_MSG_TELL, 
                        sprintf(buf2, "%s@%s", from_user, from_mud), 
                        to_user, message);
                }
                free(message);
            }
            break;
            
        case IMC_MSG_CHANNEL:
            /* Handle channel message */
            channel = imc_json_get_string(payload, "payload.channel");
            message = imc_json_get_string(payload, "payload.message");
            action = imc_json_get_string(payload, "payload.action");
            
            if (channel && message) {
                /* Broadcast to all players on this channel */
                for (ch = character_list; ch; ch = ch->next) {
                    if (IS_NPC(ch)) continue;
                    if (!imc_is_on_channel(channel, imc_get_name(ch))) continue;
                    
                    if (action && strcmp(action, "join") == 0) {
                        IMC_SEND_CHANNEL_COLOR(ch, sprintf(buf,
                            "[%s] %s@%s has joined the channel.\r\n",
                            channel, from_user, from_mud));
                    } else if (action && strcmp(action, "leave") == 0) {
                        IMC_SEND_CHANNEL_COLOR(ch, sprintf(buf,
                            "[%s] %s@%s has left the channel.\r\n",
                            channel, from_user, from_mud));
                    } else {
                        IMC_SEND_CHANNEL_COLOR(ch, sprintf(buf,
                            "[%s] %s@%s: %s\r\n",
                            channel, from_user, from_mud, message));
                    }
                }
            }
            
            if (channel) free(channel);
            if (message) free(message);
            if (action) free(action);
            break;
            
        case IMC_MSG_WHO:
            /* Handle who response - this is more complex, see full implementation */
            break;
            
        case IMC_MSG_PING:
            /* Respond to ping */
            {
                long timestamp = imc_json_get_int(payload, "payload.timestamp");
                char *pong = imc_create_pong(timestamp);
                if (pong) {
                    imc_send_message(pong);
                    free(pong);
                }
            }
            break;
            
        case IMC_MSG_PONG:
            /* Update last pong time */
            imc_data->last_pong = time(NULL);
            break;
            
        case IMC_MSG_ERROR:
            /* Handle error message */
            {
                int code = imc_json_get_int(payload, "payload.code");
                char *error_msg = imc_json_get_string(payload, "payload.message");
                imc_log("ERROR %d: %s", code, error_msg ? error_msg : "Unknown error");
                if (error_msg) free(error_msg);
            }
            break;
            
        default:
            /* Handle other message types or ignore */
            break;
    }
}

/* =================================================================== */
/* UTILITY FUNCTIONS                                                  */
/* =================================================================== */

/*
 * Generate a UUID for message IDs
 */
char *imc_generate_uuid(void) {
    static char uuid[40];
    struct timeval tv;
    
    gettimeofday(&tv, NULL);
    sprintf(uuid, "%08x-%04x-%04x-%04x-%012lx",
            (unsigned int)tv.tv_sec,
            (unsigned short)((tv.tv_usec >> 16) & 0xFFFF),
            (unsigned short)(tv.tv_usec & 0xFFFF),
            (unsigned short)(rand() & 0xFFFF),
            (unsigned long)((rand() << 16) | rand()));
    
    return strdup(uuid);
}

/*
 * Get current timestamp in ISO format
 */
char *imc_get_timestamp(void) {
    static char timestamp[64];
    time_t now = time(NULL);
    struct tm *tm_info = gmtime(&now);
    
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", tm_info);
    return strdup(timestamp);
}

/*
 * Log an IMC message
 */
void imc_log(const char *fmt, ...) {
    va_list args;
    char buf[MAX_STRING_LENGTH];
    
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    
    /* Use your MUD's logging function */
    log("IMC: %s", buf);
    
#if IMC_DEBUG
    fprintf(stderr, "IMC: %s\n", buf);
#endif
}

/*
 * Debug logging (only when enabled)
 */
void imc_debug(const char *fmt, ...) {
#if IMC_DEBUG
    va_list args;
    char buf[MAX_STRING_LENGTH];
    
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    
    fprintf(stderr, "IMC DEBUG: %s\n", buf);
#endif
}

/*
 * Rate limiting check
 */
bool imc_check_rate_limit(const char *type, const char *identifier) {
    time_t now = time(NULL);
    
    if (strcmp(type, "tell") == 0) {
        if (now != last_tell_time) {
            last_tell_time = now;
            tells_this_minute = 0;
        }
        if (tells_this_minute >= IMC_MAX_TELLS_MIN) {
            return FALSE;
        }
        tells_this_minute++;
    } else if (strcmp(type, "channel") == 0) {
        if (now != last_channel_time) {
            last_channel_time = now;
            channels_this_minute = 0;
        }
        if (channels_this_minute >= IMC_MAX_CHANNELS_MIN) {
            return FALSE;
        }
        channels_this_minute++;
    } else if (strcmp(type, "who") == 0) {
        if (now != last_who_time) {
            last_who_time = now;
            who_this_minute = 0;
        }
        if (who_this_minute >= IMC_MAX_WHO_MIN) {
            return FALSE;
        }
        who_this_minute++;
    }
    
    return TRUE;
}

/*
 * Reset rate limiting counters
 */
void imc_reset_rate_limits(void) {
    tells_this_minute = 0;
    channels_this_minute = 0;
    who_this_minute = 0;
}

/*
 * Load configuration (placeholder)
 */
void imc_load_config(void) {
    /* TODO: Load any saved configuration from file */
}

/*
 * Save configuration (placeholder)
 */
void imc_save_config(void) {
    /* TODO: Save configuration to file */
}

/* =================================================================== */
/* MESSAGE CREATION FUNCTIONS                                         */
/* =================================================================== */

/*
 * Create authentication message
 */
char *imc_create_auth(void) {
    char *json = imc_json_create_object();
    char *uuid = imc_generate_uuid();
    char *timestamp = imc_get_timestamp();
    
    imc_json_add_string(&json, "version", IMC_PROTOCOL_VERSION);
    imc_json_add_string(&json, "id", uuid);
    imc_json_add_string(&json, "timestamp", timestamp);
    imc_json_add_string(&json, "type", "auth");
    
    /* Add from object */
    char *from_obj = imc_json_create_object();
    imc_json_add_string(&from_obj, "mud", IMC_MUD_NAME);
    imc_json_add_object(&json, "from", from_obj);
    
    /* Add to object */
    char *to_obj = imc_json_create_object();
    imc_json_add_string(&to_obj, "mud", "Gateway");
    imc_json_add_object(&json, "to", to_obj);
    
    /* Add payload object */
    char *payload = imc_json_create_object();
    imc_json_add_string(&payload, "mudName", IMC_MUD_NAME);
    imc_json_add_string(&payload, "token", IMC_API_KEY);
    imc_json_add_object(&json, "payload", payload);
    
    /* Add metadata object */
    char *metadata = imc_json_create_object();
    imc_json_add_int(&metadata, "priority", IMC_MESSAGE_PRIORITY);
    imc_json_add_int(&metadata, "ttl", IMC_MESSAGE_TTL);
    imc_json_add_string(&metadata, "encoding", "utf-8");
    imc_json_add_string(&metadata, "language", "en");
    imc_json_add_object(&json, "metadata", metadata);
    
    free(uuid);
    free(timestamp);
    free(from_obj);
    free(to_obj);
    free(payload);
    free(metadata);
    
    return imc_json_finalize(json);
}

/*
 * Create ping message
 */
char *imc_create_ping(void) {
    char *json = imc_json_create_object();
    char *uuid = imc_generate_uuid();
    char *timestamp = imc_get_timestamp();
    
    imc_json_add_string(&json, "version", IMC_PROTOCOL_VERSION);
    imc_json_add_string(&json, "id", uuid);
    imc_json_add_string(&json, "timestamp", timestamp);
    imc_json_add_string(&json, "type", "ping");
    
    /* Add from/to objects */
    char *from_obj = imc_json_create_object();
    imc_json_add_string(&from_obj, "mud", IMC_MUD_NAME);
    imc_json_add_object(&json, "from", from_obj);
    
    char *to_obj = imc_json_create_object();
    imc_json_add_string(&to_obj, "mud", "Gateway");
    imc_json_add_object(&json, "to", to_obj);
    
    /* Add payload with timestamp */
    char *payload = imc_json_create_object();
    imc_json_add_int(&payload, "timestamp", (int)time(NULL));
    imc_json_add_object(&json, "payload", payload);
    
    /* Add metadata */
    char *metadata = imc_json_create_object();
    imc_json_add_int(&metadata, "priority", IMC_MESSAGE_PRIORITY);
    imc_json_add_int(&metadata, "ttl", IMC_MESSAGE_TTL);
    imc_json_add_string(&metadata, "encoding", "utf-8");
    imc_json_add_string(&metadata, "language", "en");
    imc_json_add_object(&json, "metadata", metadata);
    
    free(uuid);
    free(timestamp);
    free(from_obj);
    free(to_obj);
    free(payload);
    free(metadata);
    
    return imc_json_finalize(json);
}

/* Additional message creation functions would go here... */
/* This is a partial implementation to show the structure */