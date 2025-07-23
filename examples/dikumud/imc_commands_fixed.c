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
/* COMMAND FUNCTION DECLARATIONS                                      */
/* =================================================================== */

/* Use DO_FUN for Merc/ROM/Smaug style MUDs */
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

/* =================================================================== */
/* TELL COMMANDS                                                      */
/* =================================================================== */

/*
 * imctell - Send a tell to a player on another MUD
 * Usage: imctell player@mudname message
 */
DO_FUN(do_imctell) {
    char target[MAX_INPUT_LENGTH], message[MAX_INPUT_LENGTH];
    char *at_pos, *mudname, *username;
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_TELL(ch)) {
        send_to_char("You don't have permission to use imctell.\n\r", ch);
        return;
    }
    
    target[0] = '\0';
    message[0] = '\0';
    
    /* Parse arguments: imctell player@mud message goes here */
    if (argument[0] == '\0') {
        send_to_char("Usage: imctell <player@mudname> <message>\n\r", ch);
        send_to_char("Example: imctell john@othermud Hello there!\n\r", ch);
        return;
    }
    
    /* Extract target and message */
    argument = one_argument(argument, target);
    strcpy(message, argument);
    
    if (target[0] == '\0' || message[0] == '\0') {
        send_to_char("Usage: imctell <player@mudname> <message>\n\r", ch);
        return;
    }
    
    /* Parse target into username@mudname */
    at_pos = strchr(target, '@');
    if (!at_pos) {
        send_to_char("You must specify the target as player@mudname.\n\r", ch);
        return;
    }
    
    *at_pos = '\0';
    username = target;
    mudname = at_pos + 1;
    
    if (!IMC_VALID_USERNAME(username)) {
        send_to_char("Invalid username format.\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char("Invalid MUD name format.\n\r", ch);
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("tell", imc_get_name(ch))) {
        send_to_char("You are sending tells too quickly. Please wait.\n\r", ch);
        return;
    }
    
    /* Send the tell */
    imc_send_tell(imc_get_name(ch), mudname, username, message);
    
    /* Confirm to sender */
    sprintf(buf, "You tell %s@%s: %s\n\r", username, mudname, message);
    IMC_SEND_TELL_COLOR(ch, buf);
    
    /* Add to history */
    sprintf(buf2, "%s@%s", username, mudname);
    imc_add_history(IMC_MSG_TELL, imc_get_name(ch), buf2, message);
}

/*
 * imcemote - Send an emote to another MUD
 */
DO_FUN(do_imcemote) {
    char mudname[MAX_INPUT_LENGTH], action[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    mudname[0] = '\0';
    action[0] = '\0';
    
    argument = one_argument(argument, mudname);
    strcpy(action, argument);
    
    if (mudname[0] == '\0' || action[0] == '\0') {
        send_to_char("Usage: imcemote <mudname> <action>\n\r", ch);
        send_to_char("Example: imcemote othermud waves hello\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char("Invalid MUD name format.\n\r", ch);
        return;
    }
    
    /* Send the emote */
    imc_send_emote(imc_get_name(ch), mudname, action);
    
    /* Confirm to sender */
    sprintf(buf, "You emote to %s: %s %s\n\r", mudname, imc_get_name(ch), action);
    IMC_SEND_EMOTE_COLOR(ch, buf);
}

/* =================================================================== */
/* INFORMATION COMMANDS                                               */
/* =================================================================== */

/*
 * imcwho - Get who list from another MUD
 */
DO_FUN(do_imcwho) {
    char mudname[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_WHO(ch)) {
        send_to_char("You don't have permission to use imcwho.\n\r", ch);
        return;
    }
    
    one_argument(argument, mudname);
    
    if (mudname[0] == '\0') {
        send_to_char("Usage: imcwho <mudname>\n\r", ch);
        send_to_char("Use 'imclist' to see available MUDs.\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_MUDNAME(mudname)) {
        send_to_char("Invalid MUD name format.\n\r", ch);
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("who", imc_get_name(ch))) {
        send_to_char("You are requesting who lists too quickly. Please wait.\n\r", ch);
        return;
    }
    
    /* Send who request */
    imc_send_who_request(mudname);
    
    sprintf(buf, "Requesting who list from %s...\n\r", mudname);
    send_to_char(buf, ch);
}

/*
 * imcfinger - Get detailed info about a player
 */
DO_FUN(do_imcfinger) {
    char target[MAX_INPUT_LENGTH];
    char *at_pos, *mudname, *username;
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_FINGER(ch)) {
        send_to_char("You don't have permission to use imcfinger.\n\r", ch);
        return;
    }
    
    one_argument(argument, target);
    
    if (target[0] == '\0') {
        send_to_char("Usage: imcfinger <player@mudname>\n\r", ch);
        return;
    }
    
    /* Parse target */
    at_pos = strchr(target, '@');
    if (!at_pos) {
        send_to_char("You must specify the target as player@mudname.\n\r", ch);
        return;
    }
    
    *at_pos = '\0';
    username = target;
    mudname = at_pos + 1;
    
    if (!IMC_VALID_USERNAME(username) || !IMC_VALID_MUDNAME(mudname)) {
        send_to_char("Invalid username or MUD name format.\n\r", ch);
        return;
    }
    
    /* Send finger request */
    imc_send_finger_request(mudname, username);
    
    sprintf(buf, "Requesting information about %s@%s...\n\r", username, mudname);
    send_to_char(buf, ch);
}

/*
 * imclocate - Find which MUD a player is on
 */
DO_FUN(do_imclocate) {
    char username[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    one_argument(argument, username);
    
    if (username[0] == '\0') {
        send_to_char("Usage: imclocate <playername>\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_USERNAME(username)) {
        send_to_char("Invalid username format.\n\r", ch);
        return;
    }
    
    /* Send locate request */
    imc_send_locate_request(username);
    
    sprintf(buf, "Searching for %s across all connected MUDs...\n\r", username);
    send_to_char(buf, ch);
}

/*
 * imclist - List all connected MUDs
 */
DO_FUN(do_imclist) {
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    send_to_char("Connected MUDs:\n\r", ch);
    send_to_char("==============\n\r", ch);
    
    imc_list_muds(ch);
}

/*
 * imcstats - Show IMC statistics and status
 */
DO_FUN(do_imcstats) {
    time_t uptime;
    int hours, minutes, seconds;
    
    if (!imc_data) {
        send_to_char("MudVault Mesh is not initialized.\n\r", ch);
        return;
    }
    
    send_to_char("MudVault Mesh Status:\n\r", ch);
    send_to_char("===============\n\r", ch);
    
    sprintf(buf, "State: %s\n\r", 
        imc_data->state == IMC_AUTHENTICATED ? "Connected" :
        imc_data->state == IMC_CONNECTING ? "Connecting" :
        imc_data->state == IMC_AUTHENTICATING ? "Authenticating" :
        "Disconnected");
    send_to_char(buf, ch);
    
    if (IMC_IS_CONNECTED()) {
        uptime = IMC_UPTIME();
        hours = uptime / 3600;
        minutes = (uptime % 3600) / 60;
        seconds = uptime % 60;
        
        sprintf(buf, "Uptime: %dh %dm %ds\n\r", hours, minutes, seconds);
        send_to_char(buf, ch);
        
        sprintf(buf, "Gateway: %s:%d\n\r", IMC_GATEWAY_HOST, IMC_GATEWAY_PORT);
        send_to_char(buf, ch);
        
        sprintf(buf, "Last Ping: %ld seconds ago\n\r", 
            time(NULL) - imc_data->last_ping);
        send_to_char(buf, ch);
        
        sprintf(buf, "Last Pong: %ld seconds ago\n\r", 
            time(NULL) - imc_data->last_pong);
        send_to_char(buf, ch);
    } else {
        sprintf(buf, "Reconnect attempts: %d/%d\n\r", 
            imc_data->reconnect_attempts, IMC_MAX_RECONNECTS);
        send_to_char(buf, ch);
    }
    
    sprintf(buf, "MUD Name: %s\n\r", IMC_MUD_NAME);
    send_to_char(buf, ch);
    
    sprintf(buf, "Protocol Version: %s\n\r", IMC_PROTOCOL_VERSION);
    send_to_char(buf, ch);
}

/* =================================================================== */
/* CHANNEL COMMANDS                                                   */
/* =================================================================== */

/*
 * channels - List available channels
 */
DO_FUN(do_channels) {
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char("You don't have permission to use channels.\n\r", ch);
        return;
    }
    
    send_to_char("Available Mesh Channels:\n\r", ch);
    send_to_char("=======================\n\r", ch);
    
    imc_list_channels(ch);
}

/*
 * channel - Send a message to a channel
 */
DO_FUN(do_channel) {
    char channel_name[MAX_INPUT_LENGTH], message[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char("You don't have permission to use channels.\n\r", ch);
        return;
    }
    
    channel_name[0] = '\0';
    message[0] = '\0';
    
    argument = one_argument(argument, channel_name);
    strcpy(message, argument);
    
    if (channel_name[0] == '\0' || message[0] == '\0') {
        send_to_char("Usage: channel <channel> <message>\n\r", ch);
        send_to_char("Example: channel gossip Hello everyone!\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char("Invalid channel name format.\n\r", ch);
        return;
    }
    
    /* Check if player is on the channel */
    if (!imc_is_on_channel(channel_name, imc_get_name(ch))) {
        sprintf(buf, "You are not on channel '%s'. Use 'chjoin %s' first.\n\r", 
            channel_name, channel_name);
        send_to_char(buf, ch);
        return;
    }
    
    /* Check rate limiting */
    if (!imc_check_rate_limit("channel", imc_get_name(ch))) {
        send_to_char("You are sending channel messages too quickly. Please wait.\n\r", ch);
        return;
    }
    
    /* Send channel message */
    imc_send_channel_message(imc_get_name(ch), channel_name, message);
    
    /* Echo to sender */
    sprintf(buf, "[%s] %s: %s\n\r", channel_name, imc_get_name(ch), message);
    IMC_SEND_CHANNEL_COLOR(ch, buf);
}

/*
 * chjoin - Join a channel
 */
DO_FUN(do_chjoin) {
    char channel_name[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    if (!IMC_CAN_USE_CHANNEL(ch)) {
        send_to_char("You don't have permission to use channels.\n\r", ch);
        return;
    }
    
    one_argument(argument, channel_name);
    
    if (channel_name[0] == '\0') {
        send_to_char("Usage: chjoin <channel>\n\r", ch);
        send_to_char("Use 'channels' to see available channels.\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char("Invalid channel name format.\n\r", ch);
        return;
    }
    
    /* Check if already on channel */
    if (imc_is_on_channel(channel_name, imc_get_name(ch))) {
        sprintf(buf, "You are already on channel '%s'.\n\r", channel_name);
        send_to_char(buf, ch);
        return;
    }
    
    /* Join the channel */
    imc_join_channel(channel_name, imc_get_name(ch));
    
    sprintf(buf, "You have joined channel '%s'.\n\r", channel_name);
    IMC_SEND_INFO_COLOR(ch, buf);
}

/*
 * chleave - Leave a channel
 */
DO_FUN(do_chleave) {
    char channel_name[MAX_INPUT_LENGTH];
    
    if (!IMC_IS_CONNECTED()) {
        send_to_char("MudVault Mesh is not connected.\n\r", ch);
        return;
    }
    
    one_argument(argument, channel_name);
    
    if (channel_name[0] == '\0') {
        send_to_char("Usage: chleave <channel>\n\r", ch);
        return;
    }
    
    if (!IMC_VALID_CHANNEL(channel_name)) {
        send_to_char("Invalid channel name format.\n\r", ch);
        return;
    }
    
    /* Check if on channel */
    if (!imc_is_on_channel(channel_name, imc_get_name(ch))) {
        sprintf(buf, "You are not on channel '%s'.\n\r", channel_name);
        send_to_char(buf, ch);
        return;
    }
    
    /* Leave the channel */
    imc_leave_channel(channel_name, imc_get_name(ch));
    
    sprintf(buf, "You have left channel '%s'.\n\r", channel_name);
    IMC_SEND_INFO_COLOR(ch, buf);
}

/*
 * imchelp - Show IMC help
 */
DO_FUN(do_imchelp) {
    send_to_char("MudVault Mesh Commands:\n\r", ch);
    send_to_char("=================\n\r\n\r", ch);
    
    send_to_char("Communication:\n\r", ch);
    send_to_char("  imctell <player@mud> <message>  - Send tell to another MUD\n\r", ch);
    send_to_char("  imcemote <mud> <action>         - Send emote to another MUD\n\r", ch);
    send_to_char("\n\r", ch);
    
    send_to_char("Information:\n\r", ch);
    send_to_char("  imcwho <mud>                    - See who's online on a MUD\n\r", ch);
    send_to_char("  imcfinger <player@mud>          - Get player information\n\r", ch);
    send_to_char("  imclocate <player>              - Find which MUD a player is on\n\r", ch);
    send_to_char("  imclist                         - List connected MUDs\n\r", ch);
    send_to_char("  imcstats                        - Show IMC status and stats\n\r", ch);
    send_to_char("\n\r", ch);
    
    send_to_char("Channels:\n\r", ch);
    send_to_char("  channels                        - List available channels\n\r", ch);
    send_to_char("  chjoin <channel>                - Join a channel\n\r", ch);
    send_to_char("  chleave <channel>               - Leave a channel\n\r", ch);
    send_to_char("  channel <channel> <message>     - Send message to channel\n\r", ch);
    send_to_char("\n\r", ch);
    
    send_to_char("Utility:\n\r", ch);
    send_to_char("  imchelp                         - This help screen\n\r", ch);
    
    if (get_trust(ch) >= MAX_LEVEL - 2) {
        send_to_char("\n\rAdmin Commands:\n\r", ch);
        send_to_char("  imcreconnect                    - Force reconnection\n\r", ch);
    }
}

/* =================================================================== */
/* ADMIN COMMANDS                                                     */
/* =================================================================== */

/*
 * imcreconnect - Force reconnection
 */
DO_FUN(do_imcreconnect) {
    if (get_trust(ch) < MAX_LEVEL - 2) {
        send_to_char("You don't have permission to use this command.\n\r", ch);
        return;
    }
    
    send_to_char("Forcing IMC reconnection...\n\r", ch);
    imc_disconnect();
    if (imc_data) {
        imc_data->reconnect_attempts = 0;
    }
}

/* Placeholder implementations for other admin commands */
DO_FUN(do_imcadmin) {
    send_to_char("IMC Admin functionality not yet implemented.\n\r", ch);
}

DO_FUN(do_imcdebug) {
    send_to_char("Debug mode toggling not yet implemented.\n\r", ch);
}

DO_FUN(do_imchistory) {
    send_to_char("Message history not yet implemented.\n\r", ch);
}

DO_FUN(do_chwho) {
    send_to_char("Channel who functionality not yet implemented.\n\r", ch);
}