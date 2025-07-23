/*
 * MudVault Mesh Player Commands for DikuMUD/Merc
 * 
 * This file contains all the player commands for MudVault Mesh functionality.
 * Add these command functions to your MUD's command table.
 */

#include "sysdep.h"
#include "structs.h"
#include "utils.h"
#include "comm.h"
#include "interpreter.h"
#include "handler.h"
#include "db.h"
#include "mudvault_mesh.h"

/* =================================================================== */
/* TELL COMMANDS                                                      */
/* =================================================================== */

/*
 * imctell - Send a tell to a player on another MUD
 * Usage: imctell player@mudname message
 */
#ifdef CIRCLE_MUD
ACMD(do_imctell)
#else
DO_FUN(do_imctell)
#endif
{
    char target[MAX_INPUT_LENGTH], message[MAX_INPUT_LENGTH];
    char *at_pos, *mudname, *username;
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_TELL(ch)) {
        send_to_char(ch, "You don't have permission to use imctell.\r\n");
        return;
    }
    
    two_arguments(argument, target, message);
    
    if (!*target || !*message) {
        send_to_char(ch, "Usage: imctell <player@mudname> <message>\r\n");
        send_to_char(ch, "Example: imctell john@othermud Hello there!\r\n");
        return;
    }
    
    /* Parse target into username@mudname */
    at_pos = strchr(target, '@');
    if (!at_pos) {
        send_to_char(ch, "You must specify the target as player@mudname.\r\n");
        return;
    }
    
    *at_pos = '\0';
    username = target;
    mudname = at_pos + 1;
    
    if (!IMC_VALID_USERNAME(username)) {
        send_to_char(ch, "Invalid username format.\r\n");
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char(ch, "Invalid MUD name format.\r\n");
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("tell", imc_get_name(ch))) {
        send_to_char(ch, "You are sending tells too quickly. Please wait.\r\n");
        return;
    }
    
    /* Filter message content */
    if (IMC_FILTER_PROFANITY && !imc_filter_message(message)) {
        send_to_char(ch, "Your message contains inappropriate content.\r\n");
        return;
    }
    
    /* Send the tell */
    imc_send_tell(imc_get_name(ch), mudname, username, message);
    
    /* Confirm to sender */
    IMC_SEND_TELL_COLOR(ch, sprintf(buf, 
        "You tell %s@%s: %s\r\n", username, mudname, message));
    
    /* Add to history */
    imc_add_history(IMC_MSG_TELL, imc_get_name(ch), 
                   sprintf(buf2, "%s@%s", username, mudname), message);
}

/*
 * imcreply - Reply to the last tell received
 */
ACMD(do_imcreply) {
    /* TODO: Implement reply functionality */
    send_to_char(ch, "Reply functionality not yet implemented.\r\n");
}

/* =================================================================== */
/* EMOTE COMMANDS                                                     */
/* =================================================================== */

/*
 * imcemote - Send an emote to another MUD
 */
ACMD(do_imcemote) {
    char mudname[MAX_INPUT_LENGTH], action[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    two_arguments(argument, mudname, action);
    
    if (!*mudname || !*action) {
        send_to_char(ch, "Usage: imcemote <mudname> <action>\r\n");
        send_to_char(ch, "Example: imcemote othermud waves hello\r\n");
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char(ch, "Invalid MUD name format.\r\n");
        return;
    }
    
    /* Send the emote */
    imc_send_emote(imc_get_name(ch), mudname, action);
    
    /* Confirm to sender */
    IMC_SEND_EMOTE_COLOR(ch, sprintf(buf, 
        "You emote to %s: %s %s\r\n", mudname, imc_get_name(ch), action));
}

/*
 * imcemoteto - Send an emote directed at a specific user
 */
ACMD(do_imcemoteto) {
    char target[MAX_INPUT_LENGTH], action[MAX_INPUT_LENGTH];
    char *at_pos, *mudname, *username;
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    two_arguments(argument, target, action);
    
    if (!*target || !*action) {
        send_to_char(ch, "Usage: imcemoteto <player@mudname> <action>\r\n");
        send_to_char(ch, "Example: imcemoteto john@othermud waves at\r\n");
        return;
    }
    
    /* Parse target */
    at_pos = strchr(target, '@');
    if (!at_pos) {
        send_to_char(ch, "You must specify the target as player@mudname.\r\n");
        return;
    }
    
    *at_pos = '\0';
    username = target;
    mudname = at_pos + 1;
    
    /* Send the directed emote */
    imc_send_emoteto(imc_get_name(ch), mudname, username, action);
    
    /* Confirm to sender */
    IMC_SEND_EMOTE_COLOR(ch, sprintf(buf, 
        "You emote to %s@%s: %s %s %s\r\n", 
        username, mudname, imc_get_name(ch), action, username));
}

/* =================================================================== */
/* INFORMATION COMMANDS                                               */
/* =================================================================== */

/*
 * imcwho - Get who list from another MUD
 */
ACMD(do_imcwho) {
    char mudname[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_WHO(ch)) {
        send_to_char(ch, "You don't have permission to use imcwho.\r\n");
        return;
    }
    
    one_argument(argument, mudname);
    
    if (!*mudname) {
        send_to_char(ch, "Usage: imcwho <mudname>\r\n");
        send_to_char(ch, "Use 'imclist' to see available MUDs.\r\n");
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char(ch, "Invalid MUD name format.\r\n");
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("who", imc_get_name(ch))) {
        send_to_char(ch, "You are requesting who lists too quickly. Please wait.\r\n");
        return;
    }
    
    /* Send who request */
    imc_send_who_request(mudname);
    
    send_to_char(ch, "Requesting who list from %s...\r\n", mudname);
}

/*
 * imcfinger - Get detailed info about a player
 */
ACMD(do_imcfinger) {
    char target[MAX_INPUT_LENGTH];
    char *at_pos, *mudname, *username;
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_FINGER(ch)) {
        send_to_char(ch, "You don't have permission to use imcfinger.\r\n");
        return;
    }
    
    one_argument(argument, target);
    
    if (!*target) {
        send_to_char(ch, "Usage: imcfinger <player@mudname>\r\n");
        return;
    }
    
    /* Parse target */
    at_pos = strchr(target, '@');
    if (!at_pos) {
        send_to_char(ch, "You must specify the target as player@mudname.\r\n");
        return;
    }
    
    *at_pos = '\0';
    username = target;
    mudname = at_pos + 1;
    
    if (!IMC_VALID_USERNAME(username) || !IMC_VALID_MUDNAME(mudname)) {
        send_to_char(ch, "Invalid username or MUD name format.\r\n");
        return;
    }
    
    /* Send finger request */
    imc_send_finger_request(mudname, username);
    
    send_to_char(ch, "Requesting information about %s@%s...\r\n", username, mudname);
}

/*
 * imclocate - Find which MUD a player is on
 */
ACMD(do_imclocate) {
    char username[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    one_argument(argument, username);
    
    if (!*username) {
        send_to_char(ch, "Usage: imclocate <playername>\r\n");
        return;
    }
    
    if (!IMC_VALID_USERNAME(username)) {
        send_to_char(ch, "Invalid username format.\r\n");
        return;
    }
    
    /* Send locate request */
    imc_send_locate_request(username);
    
    send_to_char(ch, "Searching for %s across all connected MUDs...\r\n", username);
}

/*
 * imclist - List all connected MUDs
 */
ACMD(do_imclist) {
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    send_to_char(ch, "Connected MUDs:\r\n");
    send_to_char(ch, "==============\r\n");
    
    imc_list_muds(ch);
}

/*
 * imcstats - Show IMC statistics and status
 */
ACMD(do_imcstats) {
    time_t uptime;
    int hours, minutes, seconds;
    
    if (!imc_data) {
        send_to_char(ch, "MudVault Mesh is not initialized.\r\n");
        return;
    }
    
    send_to_char(ch, "MudVault Mesh Status:\r\n");
    send_to_char(ch, "===============\r\n");
    
    send_to_char(ch, "State: %s\r\n", 
        imc_data->state == IMC_AUTHENTICATED ? "Connected" :
        imc_data->state == IMC_CONNECTING ? "Connecting" :
        imc_data->state == IMC_AUTHENTICATING ? "Authenticating" :
        "Disconnected");
    
    if (IMC_IS_CONNECTED()) {
        uptime = IMC_UPTIME();
        hours = uptime / 3600;
        minutes = (uptime % 3600) / 60;
        seconds = uptime % 60;
        
        send_to_char(ch, "Uptime: %dh %dm %ds\r\n", hours, minutes, seconds);
        send_to_char(ch, "Gateway: %s:%d\r\n", IMC_GATEWAY_HOST, IMC_GATEWAY_PORT);
        send_to_char(ch, "Last Ping: %ld seconds ago\r\n", 
            time(NULL) - imc_data->last_ping);
        send_to_char(ch, "Last Pong: %ld seconds ago\r\n", 
            time(NULL) - imc_data->last_pong);
    } else {
        send_to_char(ch, "Reconnect attempts: %d/%d\r\n", 
            imc_data->reconnect_attempts, IMC_MAX_RECONNECTS);
    }
    
    send_to_char(ch, "MUD Name: %s\r\n", IMC_MUD_NAME);
    send_to_char(ch, "Protocol Version: %s\r\n", IMC_PROTOCOL_VERSION);
}

/* =================================================================== */
/* CHANNEL COMMANDS                                                   */
/* =================================================================== */

/*
 * channels - List available channels
 */
ACMD(do_channels) {
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char(ch, "You don't have permission to use channels.\r\n");
        return;
    }
    
    send_to_char(ch, "Available Mesh Channels:\r\n");
    send_to_char(ch, "=======================\r\n");
    
    imc_list_channels(ch);
}

/*
 * channel - Send a message to a channel
 */
ACMD(do_channel) {
    char channel_name[MAX_INPUT_LENGTH], message[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char(ch, "You don't have permission to use channels.\r\n");
        return;
    }
    
    two_arguments(argument, channel_name, message);
    
    if (!*channel_name || !*message) {
        send_to_char(ch, "Usage: channel <channel> <message>\r\n");
        send_to_char(ch, "Example: channel gossip Hello everyone!\r\n");
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char(ch, "Invalid channel name format.\r\n");
        return;
    }
    
    /* Check if player is on the channel */
    if (!imc_is_on_channel(channel_name, imc_get_name(ch))) {
        send_to_char(ch, "You are not on channel '%s'. Use 'chjoin %s' first.\r\n", 
            channel_name, channel_name);
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("channel", imc_get_name(ch))) {
        send_to_char(ch, "You are sending channel messages too quickly. Please wait.\r\n");
        return;
    }
    
    /* Filter message content */
    if (IMC_FILTER_PROFANITY && !imc_filter_message(message)) {
        send_to_char(ch, "Your message contains inappropriate content.\r\n");
        return;
    }
    
    /* Send channel message */
    imc_send_channel_message(imc_get_name(ch), channel_name, message);
    
    /* Echo to sender */
    IMC_SEND_CHANNEL_COLOR(ch, sprintf(buf, 
        "[%s] %s: %s\r\n", channel_name, imc_get_name(ch), message));
}

/*
 * chjoin - Join a channel
 */
ACMD(do_chjoin) {
    char channel_name[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char(ch, "You don't have permission to use channels.\r\n");
        return;
    }
    
    one_argument(argument, channel_name);
    
    if (!*channel_name) {
        send_to_char(ch, "Usage: chjoin <channel>\r\n");
        send_to_char(ch, "Use 'channels' to see available channels.\r\n");
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char(ch, "Invalid channel name format.\r\n");
        return;
    }
    
    /* Check if already on channel */
    if (imc_is_on_channel(channel_name, imc_get_name(ch))) {
        send_to_char(ch, "You are already on channel '%s'.\r\n", channel_name);
        return;
    }
    
    /* Join the channel */
    imc_join_channel(channel_name, imc_get_name(ch));
    
    IMC_SEND_INFO_COLOR(ch, sprintf(buf, 
        "You have joined channel '%s'.\r\n", channel_name));
}

/*
 * chleave - Leave a channel
 */
ACMD(do_chleave) {
    char channel_name[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    one_argument(argument, channel_name);
    
    if (!*channel_name) {
        send_to_char(ch, "Usage: chleave <channel>\r\n");
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char(ch, "Invalid channel name format.\r\n");
        return;
    }
    
    /* Check if on channel */
    if (!imc_is_on_channel(channel_name, imc_get_name(ch))) {
        send_to_char(ch, "You are not on channel '%s'.\r\n", channel_name);
        return;
    }
    
    /* Leave the channel */
    imc_leave_channel(channel_name, imc_get_name(ch));
    
    IMC_SEND_INFO_COLOR(ch, sprintf(buf, 
        "You have left channel '%s'.\r\n", channel_name));
}

/*
 * chwho - Show who is on a channel
 */
ACMD(do_chwho) {
    char channel_name[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char(ch, "MudVault Mesh is not connected.\r\n");
        return;
    }
    
    one_argument(argument, channel_name);
    
    if (!*channel_name) {
        send_to_char(ch, "Usage: chwho <channel>\r\n");
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char(ch, "Invalid channel name format.\r\n");
        return;
    }
    
    /* TODO: Implement channel who functionality */
    send_to_char(ch, "Channel who functionality not yet implemented.\r\n");
}

/* =================================================================== */
/* UTILITY AND ADMIN COMMANDS                                        */
/* =================================================================== */

/*
 * imchistory - Show message history
 */
ACMD(do_imchistory) {
    char type[MAX_INPUT_LENGTH], count_str[MAX_INPUT_LENGTH];
    int count = 10;
    imc_msg_type_t msg_type = IMC_MSG_TELL;
    
    two_arguments(argument, type, count_str);
    
    if (*count_str) {
        count = atoi(count_str);
        if (count < 1 || count > 50) {
            send_to_char(ch, "Count must be between 1 and 50.\r\n");
            return;
        }
    }
    
    if (*type) {
        if (strcmp(type, "tell") == 0) msg_type = IMC_MSG_TELL;
        else if (strcmp(type, "channel") == 0) msg_type = IMC_MSG_CHANNEL;
        else if (strcmp(type, "emote") == 0) msg_type = IMC_MSG_EMOTE;
        else {
            send_to_char(ch, "Valid types: tell, channel, emote\r\n");
            return;
        }
    }
    
    send_to_char(ch, "Message History (%s):\r\n", type);
    send_to_char(ch, "====================\r\n");
    
    imc_show_history(ch, msg_type, count);
}

/*
 * imchelp - Show IMC help
 */
ACMD(do_imchelp) {
    send_to_char(ch, "MudVault Mesh Commands:\r\n");
    send_to_char(ch, "=================\r\n\r\n");
    
    send_to_char(ch, "Communication:\r\n");
    send_to_char(ch, "  imctell <player@mud> <message>  - Send tell to another MUD\r\n");
    send_to_char(ch, "  imcemote <mud> <action>         - Send emote to another MUD\r\n");
    send_to_char(ch, "  imcemoteto <player@mud> <action> - Send directed emote\r\n\r\n");
    
    send_to_char(ch, "Information:\r\n");
    send_to_char(ch, "  imcwho <mud>                    - See who's online on a MUD\r\n");
    send_to_char(ch, "  imcfinger <player@mud>          - Get player information\r\n");
    send_to_char(ch, "  imclocate <player>              - Find which MUD a player is on\r\n");
    send_to_char(ch, "  imclist                         - List connected MUDs\r\n");
    send_to_char(ch, "  imcstats                        - Show IMC status and stats\r\n\r\n");
    
    send_to_char(ch, "Channels:\r\n");
    send_to_char(ch, "  channels                        - List available channels\r\n");
    send_to_char(ch, "  chjoin <channel>                - Join a channel\r\n");
    send_to_char(ch, "  chleave <channel>               - Leave a channel\r\n");
    send_to_char(ch, "  channel <channel> <message>     - Send message to channel\r\n");
    send_to_char(ch, "  chwho <channel>                 - See who's on a channel\r\n\r\n");
    
    send_to_char(ch, "Utility:\r\n");
    send_to_char(ch, "  imchistory [type] [count]       - Show message history\r\n");
    send_to_char(ch, "  imchelp                         - This help screen\r\n\r\n");
    
    if (GET_LEVEL(ch) >= LVL_IMMORT) {
        send_to_char(ch, "Admin Commands:\r\n");
        send_to_char(ch, "  imcadmin                        - IMC administration\r\n");
        send_to_char(ch, "  imcreconnect                    - Force reconnection\r\n");
        send_to_char(ch, "  imcdebug                        - Toggle debug mode\r\n");
    }
}

/* =================================================================== */
/* ADMIN COMMANDS                                                     */
/* =================================================================== */

/*
 * imcadmin - Administrative commands
 */
ACMD(do_imcadmin) {
    if (GET_LEVEL(ch) < LVL_GRGOD) {
        send_to_char(ch, "You don't have permission to use IMC admin commands.\r\n");
        return;
    }
    
    /* TODO: Implement admin functionality */
    send_to_char(ch, "IMC Admin functionality not yet implemented.\r\n");
}

/*
 * imcreconnect - Force reconnection
 */
ACMD(do_imcreconnect) {
    if (GET_LEVEL(ch) < LVL_GRGOD) {
        send_to_char(ch, "You don't have permission to use this command.\r\n");
        return;
    }
    
    send_to_char(ch, "Forcing IMC reconnection...\r\n");
    imc_disconnect();
    imc_data->reconnect_attempts = 0;
    
    /* Connection will be attempted on next loop */
}

/*
 * imcdebug - Toggle debug mode
 */
ACMD(do_imcdebug) {
    if (GET_LEVEL(ch) < LVL_GRGOD) {
        send_to_char(ch, "You don't have permission to use this command.\r\n");
        return;
    }
    
    /* TODO: Implement debug toggling */
    send_to_char(ch, "Debug mode toggling not yet implemented.\r\n");
}