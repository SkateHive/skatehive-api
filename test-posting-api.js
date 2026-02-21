#!/usr/bin/env node

/**
 * Test script for Skatehive Posting API endpoints
 * 
 * Usage:
 *   node test-posting-api.js blog
 *   node test-posting-api.js feed
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.SKATEHIVE_API_KEY;
const HIVE_USERNAME = process.env.HIVE_USERNAME;
const POSTING_KEY = process.env.HIVE_POSTING_KEY;

if (!API_KEY) {
  console.error('❌ Missing SKATEHIVE_API_KEY environment variable');
  console.log('Set it with: export SKATEHIVE_API_KEY="your-key-here"');
  process.exit(1);
}

if (!HIVE_USERNAME) {
  console.error('❌ Missing HIVE_USERNAME environment variable');
  console.log('Set it with: export HIVE_USERNAME="yourhiveusername"');
  process.exit(1);
}

if (!POSTING_KEY) {
  console.error('❌ Missing HIVE_POSTING_KEY environment variable');
  console.log('Set it with: export HIVE_POSTING_KEY="5K..."');
  process.exit(1);
}

async function testComposeBlog() {
  console.log('🧪 Testing POST /api/v2/composeBlog');
  
  const data = {
    author: HIVE_USERNAME,
    posting_key: POSTING_KEY,
    title: `Test Blog Post ${Date.now()}`,
    body: `## Test Blog Post

This is a test post created via the Skatehive API.

### Features
- Markdown support
- IPFS images
- Beneficiaries
- Tags

**Posted at:** ${new Date().toISOString()}
**Posted by:** ${HIVE_USERNAME}

![Skatehive](https://i.imgur.com/placeholder.jpg)
`,
    thumbnail: 'https://i.imgur.com/placeholder.jpg',
    tags: ['test', 'skateboarding', 'hive-173115', 'api'],
    images: ['https://i.imgur.com/placeholder.jpg'],
    beneficiaries: [
      {
        account: 'skatehacker',
        weight: 500 // 5%
      }
    ]
  };
  
  try {
    const response = await fetch(`${API_URL}/api/v2/composeBlog`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log('📄 Post URL:', result.data.url);
      console.log('🔗 Hive URL:', result.data.hive_url);
      console.log('📝 Transaction ID:', result.data.transaction_id);
    } else {
      console.log('❌ Failed');
      console.log('Error:', result.error);
      if (result.details) {
        console.log('Details:', result.details);
      }
    }
    
    return result;
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    throw error;
  }
}

async function testPostFeed() {
  console.log('🧪 Testing POST /api/v2/postFeed');
  
  const data = {
    author: HIVE_USERNAME,
    posting_key: POSTING_KEY,
    body: `Just landed my first kickflip! 🛹

#skateboarding #progress #test

Posted via Skatehive API at ${new Date().toLocaleTimeString()} by @${HIVE_USERNAME}`,
    images: [
      'https://i.imgur.com/placeholder.jpg'
    ]
  };
  
  try {
    const response = await fetch(`${API_URL}/api/v2/postFeed`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log('📄 Post URL:', result.data.url);
      console.log('🔗 Hive URL:', result.data.hive_url);
      console.log('📝 Transaction ID:', result.data.transaction_id);
      console.log('👤 Parent:', `${result.data.parent_author}/${result.data.parent_permlink}`);
    } else {
      console.log('❌ Failed');
      console.log('Error:', result.error);
      if (result.details) {
        console.log('Details:', result.details);
      }
    }
    
    return result;
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    throw error;
  }
}

// Main
const command = process.argv[2];

if (command === 'blog') {
  testComposeBlog().catch(() => process.exit(1));
} else if (command === 'feed') {
  testPostFeed().catch(() => process.exit(1));
} else {
  console.log(`
Usage: node test-posting-api.js <command>

Commands:
  blog    Test composeBlog endpoint (full blog post)
  feed    Test postFeed endpoint (snap/short post)

Environment:
  API_URL             API base URL (default: http://localhost:3000)
  SKATEHIVE_API_KEY   Your API key (required)
  HIVE_USERNAME       Your Hive username (required)
  HIVE_POSTING_KEY    Your Hive posting key (required)

Examples:
  export SKATEHIVE_API_KEY="your-api-key-here"
  export HIVE_USERNAME="yourhiveusername"
  export HIVE_POSTING_KEY="5K..."
  node test-posting-api.js blog
  node test-posting-api.js feed
  `);
  process.exit(1);
}
