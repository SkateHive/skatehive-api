#!/bin/bash

# Setup Vercel Environment Variables for Skatehive API
# Usage: ./setup-vercel-env.sh

echo "🔐 Skatehive API - Vercel Environment Setup"
echo "=========================================="
echo ""

# Check if vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found"
    echo "Install with: npm i -g vercel"
    exit 1
fi

echo "✅ Vercel CLI found"
echo ""

# Generate API keys
echo "📋 Generating example API keys..."
echo ""

KEY1=$(openssl rand -hex 32)
KEY2=$(openssl rand -hex 32)

echo "Generated keys:"
echo "  Bot Key:    $KEY1"
echo "  App Key:    $KEY2"
echo ""

# Ask for posting key
echo "🔑 Enter your Hive posting key (starts with 5K...):"
read -s POSTING_KEY
echo ""

# Ask for account name
echo "👤 Enter Hive account name (default: skateuser):"
read ACCOUNT
ACCOUNT=${ACCOUNT:-skateuser}
echo ""

# Format API keys
API_KEYS="${KEY1}:SkatehiveBot,${KEY2}:SkatehiveApp"

echo "📝 Configuration Summary:"
echo "  SKATEHIVE_API_KEYS: ${KEY1:0:16}...,(2 keys)"
echo "  SKATEHIVE_ACCOUNT:  $ACCOUNT"
echo "  SKATEHIVE_POSTING_KEY: [HIDDEN]"
echo ""

echo "🚀 Choose deployment method:"
echo "  1) Vercel Dashboard (manual - recommended)"
echo "  2) Vercel CLI (automatic)"
echo ""
read -p "Select [1-2]: " CHOICE

if [ "$CHOICE" == "1" ]; then
    echo ""
    echo "📋 Manual Setup Instructions:"
    echo "=========================================="
    echo ""
    echo "1. Go to: https://vercel.com/your-team/skatehive-api/settings/environment-variables"
    echo ""
    echo "2. Add these variables:"
    echo ""
    echo "   Name: SKATEHIVE_API_KEYS"
    echo "   Value: $API_KEYS"
    echo "   Environments: ✓ Production ✓ Preview ✓ Development"
    echo ""
    echo "   Name: SKATEHIVE_POSTING_KEY"
    echo "   Value: $POSTING_KEY"
    echo "   Environments: ✓ Production ✓ Preview"
    echo ""
    echo "   Name: SKATEHIVE_ACCOUNT"
    echo "   Value: $ACCOUNT"
    echo "   Environments: ✓ Production ✓ Preview ✓ Development"
    echo ""
    echo "3. Click 'Save'"
    echo ""
    echo "4. Redeploy: vercel --prod"
    echo ""
    
    # Save to local file for reference
    cat > .vercel-env-backup.txt << EOF
# Backup of Vercel environment variables (DO NOT COMMIT)
# Generated: $(date)

SKATEHIVE_API_KEYS=$API_KEYS
SKATEHIVE_POSTING_KEY=$POSTING_KEY
SKATEHIVE_ACCOUNT=$ACCOUNT

# Copy these to Vercel Dashboard:
# https://vercel.com/your-team/skatehive-api/settings/environment-variables
EOF
    
    echo "💾 Saved to .vercel-env-backup.txt (added to .gitignore)"
    
elif [ "$CHOICE" == "2" ]; then
    echo ""
    echo "🚀 Setting up via Vercel CLI..."
    echo ""
    
    # Add to production
    echo "$API_KEYS" | vercel env add SKATEHIVE_API_KEYS production
    echo "$POSTING_KEY" | vercel env add SKATEHIVE_POSTING_KEY production
    echo "$ACCOUNT" | vercel env add SKATEHIVE_ACCOUNT production
    
    # Add to preview
    echo "$API_KEYS" | vercel env add SKATEHIVE_API_KEYS preview
    echo "$POSTING_KEY" | vercel env add SKATEHIVE_POSTING_KEY preview
    echo "$ACCOUNT" | vercel env add SKATEHIVE_ACCOUNT preview
    
    echo ""
    echo "✅ Environment variables configured!"
    echo ""
    echo "🚀 Redeploy with: vercel --prod"
else
    echo "❌ Invalid choice"
    exit 1
fi

echo ""
echo "📝 API Keys for your apps/bots:"
echo "=========================================="
echo ""
echo "Bot Key:  $KEY1"
echo "App Key:  $KEY2"
echo ""
echo "Use in requests:"
echo "  curl -H 'Authorization: Bearer $KEY1' ..."
echo ""
echo "✅ Setup complete!"
