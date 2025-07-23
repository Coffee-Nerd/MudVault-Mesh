import { EmbedBuilder } from 'discord.js';

/**
 * Utility functions for formatting messages and embeds
 */

export class MessageFormatter {
  /**
   * Format a who list for Discord display
   */
  static formatWhoList(whoData: any): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];
    
    for (const mudName in whoData) {
      const players = whoData[mudName];
      
      // Create embed for each MUD
      const embed = new EmbedBuilder()
        .setTitle(`🌍 ${mudName}`)
        .setColor(0x00ff00)
        .setTimestamp();

      if (players.length === 0) {
        embed.setDescription('```ansi\n\u001b[0;31mNo players online\u001b[0m\n```');
      } else {
        // Format player list with ANSI colors
        let playerList = '';
        players.forEach((player: any, index: number) => {
          const prefix = index === 0 ? '┌─' : '├─';
          const suffix = index === players.length - 1 ? '└─' : '';
          
          playerList += `${prefix} \u001b[1;36m${player.name}\u001b[0m`;
          
          if (player.title) {
            playerList += ` \u001b[0;37m${player.title}\u001b[0m`;
          }
          
          if (player.level) {
            playerList += ` \u001b[0;33m[${player.level}]\u001b[0m`;
          }
          
          if (player.class) {
            playerList += ` \u001b[0;35m${player.class}\u001b[0m`;
          }
          
          playerList += '\n';
        });

        embed.setDescription(`\`\`\`ansi\n${playerList}\`\`\``);
        embed.setFooter({
          text: `${players.length} player${players.length === 1 ? '' : 's'} online`
        });
      }

      embeds.push(embed);
    }

    return embeds;
  }

  /**
   * Format score/stat information
   */
  static formatScore(scoreData: string, playerName: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${playerName}'s Stats`)
      .setColor(0xffd700) // Gold color
      .setTimestamp();

    // Convert MUD colors to ANSI if needed
    const formattedScore = this.convertMudColorsToAnsi(scoreData);
    
    embed.setDescription(`\`\`\`ansi\n${formattedScore}\n\`\`\``);

    return embed;
  }

  /**
   * Format death information
   */
  static formatDeathInfo(deathInfo: {
    vnum: string;
    roomName: string;
    exits: string;
    area: string;
    playerName: string;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('💀 Player Death')
      .setColor(0xff0000) // Red color
      .setTimestamp()
      .addFields(
        { name: '👤 Player', value: deathInfo.playerName, inline: true },
        { name: '📍 Room VNUM', value: deathInfo.vnum, inline: true },
        { name: '🏠 Room Name', value: deathInfo.roomName, inline: false },
        { name: '🚪 Exits', value: deathInfo.exits || 'None', inline: true },
        { name: '🗺️ Area', value: deathInfo.area, inline: true }
      );

    return embed;
  }

  /**
   * Format room information 
   */
  static formatRoomInfo(roomInfo: {
    vnum: string;
    name: string;
    exits: string;
    area: string;
    timeSpent: string;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('🏠 Room Information')
      .setColor(0x808080) // Gray color
      .setTimestamp()
      .addFields(
        { name: '📍 VNUM', value: roomInfo.vnum, inline: true },
        { name: '🏠 Name', value: roomInfo.name, inline: false },
        { name: '🚪 Exits', value: roomInfo.exits || 'None', inline: true },
        { name: '🗺️ Area', value: roomInfo.area, inline: true },
        { name: '⏱️ Time Spent', value: roomInfo.timeSpent, inline: true }
      );

    return embed;
  }

  /**
   * Format verification success message
   */
  static formatVerificationSuccess(discordUser: string, mudName: string, mudUsername: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('✅ Verification Successful')
      .setColor(0x00ff00)
      .setDescription(`Successfully linked accounts!`)
      .addFields(
        { name: '👤 Discord User', value: discordUser, inline: true },
        { name: '🎮 MUD', value: mudName, inline: true },
        { name: '🧙 Character', value: mudUsername, inline: true }
      )
      .setTimestamp();
  }

  /**
   * Convert common MUD color codes to ANSI
   */
  private static convertMudColorsToAnsi(text: string): string {
    const colorMap: { [key: string]: string } = {
      '@r': '\u001b[0;31m',  // Red
      '@R': '\u001b[1;31m',  // Bright Red
      '@g': '\u001b[0;32m',  // Green
      '@G': '\u001b[1;32m',  // Bright Green
      '@y': '\u001b[0;33m',  // Yellow
      '@Y': '\u001b[1;33m',  // Bright Yellow
      '@b': '\u001b[0;34m',  // Blue
      '@B': '\u001b[1;34m',  // Bright Blue
      '@m': '\u001b[0;35m',  // Magenta
      '@M': '\u001b[1;35m',  // Bright Magenta
      '@c': '\u001b[0;36m',  // Cyan
      '@C': '\u001b[1;36m',  // Bright Cyan
      '@w': '\u001b[0;37m',  // White
      '@W': '\u001b[1;37m',  // Bright White
      '@x': '\u001b[0m',     // Reset
      '@D': '\u001b[1;30m',  // Dark Gray
      '@d': '\u001b[0;30m',  // Black
    };

    // Handle @x### codes (xterm 256 colors)
    text = text.replace(/@x(\d{3})/g, (match, code) => {
      const colorCode = parseInt(code);
      if (colorCode >= 0 && colorCode <= 255) {
        return `\u001b[38;5;${colorCode}m`;
      }
      return match;
    });

    // Replace standard color codes
    for (const [code, ansi] of Object.entries(colorMap)) {
      text = text.replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ansi);
    }

    // Ensure we end with a reset
    if (!text.endsWith('\u001b[0m')) {
      text += '\u001b[0m';
    }

    return text;
  }

  /**
   * Create a terminal-style embed frame
   */
  static createTerminalEmbed(title: string, content: string, color: number = 0x000000): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(`💻 ${title}`)
      .setDescription(`\`\`\`ansi\n${content}\n\`\`\``)
      .setColor(color)
      .setTimestamp();
  }

  /**
   * Format channel list
   */
  static formatChannelList(channels: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('📺 Available Channels')
      .setColor(0x5865f2)
      .setTimestamp();

    if (channels.length === 0) {
      embed.setDescription('```ansi\n\u001b[0;31mNo channels available\u001b[0m\n```');
    } else {
      let channelList = '';
      channels.forEach((channel, index) => {
        const prefix = index === 0 ? '┌─' : index === channels.length - 1 ? '└─' : '├─';
        channelList += `${prefix} \u001b[1;36m#${channel}\u001b[0m\n`;
      });

      embed.setDescription(`\`\`\`ansi\n${channelList}\`\`\``);
      embed.setFooter({
        text: `${channels.length} channel${channels.length === 1 ? '' : 's'} available`
      });
    }

    return embed;
  }
}