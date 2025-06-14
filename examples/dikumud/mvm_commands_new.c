/*
 * MudVault Mesh Commands for DikuMUD/Merc
 * 
 * Player-accessible commands for MudVault Mesh functionality
 * Main command: mvm with subcommands (tell, who, finger, etc.)
 * 
 * Author: MudVault Team
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

/* =================================================================== */
/* COMMAND PROTOTYPES                                                  */
/* =================================================================== */

/* Subcommand functions */
ACMD(do_mvm_tell);
ACMD(do_mvm_who);
ACMD(do_mvm_finger);
ACMD(do_mvm_locate);
ACMD(do_mvm_channels);
ACMD(do_mvm_join);
ACMD(do_mvm_leave);
ACMD(do_mvm_list);
ACMD(do_mvm_stats);
ACMD(do_mvm_help);

/* Helper functions */
char *parse_player_mud(char *input, char **player, char **mud);
bool is_valid_mud_name(char *name);
bool is_valid_player_name(char *name);
void show_mvm_help(struct char_data *ch);

/* =================================================================== */
/* MAIN MVM COMMAND - Handles all subcommands                         */
/* =================================================================== */

ACMD(do_mvm) {
    char subcmd[MAX_INPUT_LENGTH];
    char *args;
    
    /* Check if mesh is active */
    if (!mvm_is_active()) {
        send_to_char(ch, "MudVault Mesh is not currently connected.\r\n");
        return;
    }
    
    /* Parse subcommand */
    args = one_argument(argument, subcmd);
    
    if (!*subcmd) {
        show_mvm_help(ch);
        return;
    }
    
    /* Route to appropriate subcommand */
    if (is_abbrev(subcmd, "tell")) {
        do_mvm_tell(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "who")) {
        do_mvm_who(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "finger")) {
        do_mvm_finger(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "locate")) {
        do_mvm_locate(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "channels")) {
        do_mvm_channels(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "join")) {
        do_mvm_join(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "leave")) {
        do_mvm_leave(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "list")) {
        do_mvm_list(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "stats")) {
        do_mvm_stats(ch, args, cmd, subcmd);
    } else if (is_abbrev(subcmd, "help")) {
        do_mvm_help(ch, args, cmd, subcmd);
    } else {
        send_to_char(ch, "Unknown MudVault Mesh subcommand '%s'. Type 'mvm help' for usage.\r\n", subcmd);
    }
}

/*
 * mvm tell <player@mud> <message>
 * Send a tell to a player on another MUD
 */
ACMD(do_mvm_tell) {
    char target[MAX_INPUT_LENGTH];
    char *player, *mud, *message;
    
    /* Parse arguments */
    argument = one_argument(argument, target);
    message = argument;
    
    if (!*target || !*message) {
        send_to_char(ch, "Usage: mvm tell <player@mud> <message>\r\n");
        return;
    }
    
    /* Parse player@mud format */
    if (!parse_player_mud(target, &player, &mud)) {
        send_to_char(ch, "Invalid format. Use: player@mudname\r\n");
        return;
    }
    
    /* Send the tell */
    if (mvm_send_tell(ch, player, mud, message)) {
        send_to_char(ch, "You tell %s@%s: %s\r\n", player, mud, message);
    } else {
        send_to_char(ch, "Failed to send tell to %s@%s.\r\n", player, mud);
    }
}

/*
 * mvm who [mud]
 * Show who's online on a specific MUD or all MUDs
 */
ACMD(do_mvm_who) {
    char mudname[MAX_INPUT_LENGTH];
    
    one_argument(argument, mudname);
    
    if (*mudname) {
        /* Request who list for specific MUD */
        if (mvm_request_who(ch, mudname)) {
            send_to_char(ch, "Requesting who list from %s...\r\n", mudname);
        } else {
            send_to_char(ch, "Failed to request who list from %s.\r\n", mudname);
        }
    } else {
        /* Show who for all connected MUDs */
        if (mvm_request_who_all(ch)) {
            send_to_char(ch, "Requesting who lists from all connected MUDs...\r\n");
        } else {
            send_to_char(ch, "Failed to request who lists.\r\n");
        }
    }
}

/*
 * Show help for MudVault Mesh commands
 */
void show_mvm_help(struct char_data *ch) {
    send_to_char(ch, "\r\nMudVault Mesh Commands:\r\n");
    send_to_char(ch, "========================\r\n\r\n");
    send_to_char(ch, "mvm tell <player@mud> <message> - Send tell to player on another MUD\r\n");
    send_to_char(ch, "mvm who [mud]                   - Show who's online (all MUDs or specific)\r\n");
    send_to_char(ch, "mvm finger <player@mud>         - Get detailed info about a player\r\n");
    send_to_char(ch, "mvm locate <player>             - Find which MUD a player is on\r\n");
    send_to_char(ch, "mvm channels                    - List available channels\r\n");
    send_to_char(ch, "mvm join <channel>              - Join a mesh channel\r\n");
    send_to_char(ch, "mvm leave <channel>             - Leave a mesh channel\r\n");
    send_to_char(ch, "mvm list                        - List connected MUDs\r\n");
    send_to_char(ch, "mvm stats                       - Show mesh statistics\r\n");
    send_to_char(ch, "\r\nExamples:\r\n");
    send_to_char(ch, "  mvm tell john@othermud Hello there!\r\n");
    send_to_char(ch, "  mvm who othermud\r\n");
    send_to_char(ch, "  mvm join gossip\r\n");
}

/*
 * Parse "player@mud" format
 */
char *parse_player_mud(char *input, char **player, char **mud) {
    char *at_sign;
    static char buffer[MAX_INPUT_LENGTH];
    
    strcpy(buffer, input);
    at_sign = strchr(buffer, '@');
    if (!at_sign) return FALSE;
    
    *at_sign = '\0';
    *player = buffer;
    *mud = at_sign + 1;
    
    return (*player && **player && *mud && **mud);
}