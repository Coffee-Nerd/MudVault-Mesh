#!/bin/bash

# MudVault Mesh Production Deployment Script

echo "🚀 Starting MudVault Mesh deployment..."

# Create logs directory
mkdir -p logs

# Build the project
echo "📦 Building TypeScript..."
npm run build

# Stop existing PM2 process if running
echo "🛑 Stopping existing process..."
pm2 stop mudvault-mesh 2>/dev/null || true

# Start with PM2
echo "▶️ Starting MudVault Mesh with PM2..."
pm2 start ecosystem.config.js

# Save PM2 configuration
echo "💾 Saving PM2 configuration..."
pm2 save

# Show status
echo "📊 Process Status:"
pm2 status

echo "✅ Deployment complete!"
echo ""
echo "🌐 HTTP API: http://$(hostname -I | awk '{print $1}'):8080"
echo "🔌 WebSocket: ws://$(hostname -I | awk '{print $1}'):8082"
echo ""
echo "📝 Useful commands:"
echo "  pm2 logs mudvault-mesh    # View logs"
echo "  pm2 monit                 # Monitor performance"
echo "  pm2 restart mudvault-mesh # Restart service"
echo "  pm2 stop mudvault-mesh    # Stop service"