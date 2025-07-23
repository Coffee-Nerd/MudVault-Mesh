# MudVault Discord Bridge

A secure Discord bot that bridges messages between Discord and the MudVault Mesh network, allowing Discord users to communicate with MUD players across multiple games.

## Features

### Security
- **User Verification**: Links Discord accounts to MUD characters with secure verification codes
- **Rate Limiting**: Prevents spam with configurable per-user message and command limits
- **Access Control**: Whitelist specific MUDs and block individual users
- **Anti-Impersonation**: Verified mapping between Discord and MUD identities

### Functionality
- **Bidirectional Messaging**: Messages flow seamlessly between Discord and MudVault
- **Channel Support**: Bridge multiple MUD channels to Discord
- **Who List**: See who's online across all connected MUDs
- **Status Tracking**: Monitor verification status and rate limits
- **Admin Commands**: Manage users and reset rate limits

## Installation

1. Clone the repository and navigate to the Discord bot directory:
```bash
cd packages/discord-bot
npm install
```

2. Create a Discord application and bot:
   - Go to https://discord.com/developers/applications
   - Create a new application
   - Go to the Bot section and create a bot
   - Copy the bot token
   - Enable "Message Content Intent" in the bot settings

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Build and start the bot:
```bash
npm run build
npm start
```

## Configuration

### Required Environment Variables

- `DISCORD_TOKEN`: Your Discord bot token
- `DISCORD_GUILD_ID`: The ID of your Discord server
- `DISCORD_BRIDGE_CHANNEL_ID`: Channel where bridged messages appear
- `MUDVAULT_API_KEY`: Your MudVault Mesh API key

### Security Configuration

```env
# Require users to verify before sending messages
REQUIRE_VERIFICATION=true

# Rate limiting (messages per minute)
RATE_LIMIT_MESSAGES=10
RATE_LIMIT_COMMANDS=5

# Whitelist specific MUDs (comma-separated)
ALLOWED_MUDS=TruthMUD,ExampleMUD

# Block specific users (comma-separated Discord IDs)
BLOCKED_USERS=123456789,987654321
```

## User Verification Flow

1. Discord user runs `/verify <mud> <character>`
2. Bot generates a 6-character verification code
3. User enters `mudvault verify <code>` in their MUD
4. MUD sends verification to MudVault Mesh
5. Bridge confirms the link and notifies both sides
6. User can now send messages through the bridge

### Security Features of Verification

- **Time-Limited Codes**: Verification codes expire after 5 minutes
- **One-Time Use**: Each code can only be used once
- **MUD-Side Validation**: Character must exist and be logged in
- **No Impersonation**: Only the player can verify their own character

## Commands

### User Commands
- `/verify <mud> <character>` - Link your Discord account to a MUD character
- `/unverify` - Unlink your Discord account
- `/status` - Check your verification status and rate limits
- `/who` - See who's online across connected MUDs
- `/channels` - List available MudVault channels

### Admin Commands
- `/admin resetlimits <user>` - Reset rate limits for a user
- `/admin ban <user>` - Ban a user from using the bridge
- `/admin unban <user>` - Unban a user

## Message Flow

### Discord → MudVault
1. User sends message in bridge channel
2. Bot verifies user is linked and not rate limited
3. Message is sent to MudVault with user's MUD identity
4. MudVault routes to appropriate MUD(s)

### MudVault → Discord
1. MUD player sends message to bridged channel
2. MudVault routes to Discord bridge
3. Bot formats and posts to Discord channel
4. Original sender shown as "Character @ MUD"

## Security Considerations

### Rate Limiting
The bridge implements multiple layers of rate limiting:
- **Per-User Limits**: Individual message and command rates
- **Global Limits**: Overall bridge message rate
- **Penalty System**: Automatic temporary bans for spam

### Data Privacy
- Verification mappings stored in Redis with encryption
- No message content is permanently stored
- Minimal logging of user data
- Discord IDs never sent to MUDs

### Access Control
- Guild-specific deployment (one Discord server)
- Channel-specific bridging
- Admin role requirements for management
- MUD whitelist/blacklist support

## Development

### Project Structure
```
src/
├── bot/           # Discord bot implementation
├── mudvault/      # MudVault client wrapper
├── security/      # Verification and rate limiting
├── types.ts       # TypeScript type definitions
├── Bridge.ts      # Main bridge orchestrator
└── index.ts       # Application entry point
```

### Running in Development
```bash
npm run dev
```

### Testing
```bash
npm test
```

## Monitoring

The bridge logs statistics every minute including:
- Connection status for both Discord and MudVault
- Message counts and queue sizes
- Number of verified users
- Rate limit violations

## Troubleshooting

### Bot not responding to commands
1. Check bot has proper permissions in Discord
2. Verify slash commands are registered (may take up to 1 hour)
3. Check logs for errors

### Verification failing
1. Ensure code is entered exactly as shown
2. Verify within 5 minutes of generation
3. Character must be logged into the MUD
4. Check MUD is in allowed list

### Messages not bridging
1. Verify user is linked (`/status`)
2. Check rate limits haven't been exceeded
3. Ensure MUD is connected to MudVault
4. Check channel configuration

## License

MIT License - See LICENSE file for details