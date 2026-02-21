# Skatehive API - Posting Endpoints

Authenticated endpoints for bots and apps to post content to Skatehive.

---

## Authentication

All posting endpoints require an API key via Bearer token:

```bash
Authorization: Bearer <your_api_key>
```

### Getting an API Key

Contact the Skatehive team to request an API key for your app/bot.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/v2/composeBlog` | 20 requests/minute |
| `/api/v2/postFeed` | 50 requests/minute |

Rate limit headers are included in responses:
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Endpoints

### 1. POST `/api/v2/composeBlog`

Create a full blog post with title, markdown, and metadata.

**Request Body:**

```typescript
{
  author: string;             // Required (your Hive username)
  posting_key: string;        // Required (your Hive posting key)
  title: string;              // Required
  body: string;               // Required (markdown)
  thumbnail: string;          // Required (IPFS or regular URL)
  tags?: string[];            // Optional (default: ['hive-173115', 'skateboarding'])
  images?: string[];          // Optional (URLs for metadata)
  beneficiaries?: Array<{     // Optional
    account: string;
    weight: number;           // 1-10000 (0.01% - 100%)
  }>;
}
```

**Example Request:**

```bash
curl -X POST https://api.skatehive.app/api/v2/composeBlog \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "yourhiveusername",
    "posting_key": "5K...",
    "title": "My First Skatehive Post",
    "body": "## Hello Skatehive!\n\nThis is my first post via API.\n\n![](https://ipfs.skatehive.app/ipfs/Qm...)",
    "thumbnail": "https://ipfs.skatehive.app/ipfs/Qm...",
    "tags": ["skateboarding", "tutorial", "hive-173115"],
    "beneficiaries": [
      {
        "account": "skatehacker",
        "weight": 1000
      }
    ]
  }'
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "author": "yourhiveusername",
    "permlink": "my-first-skatehive-post-1708563242",
    "title": "My First Skatehive Post",
    "url": "https://skatehive.app/post/yourhiveusername/my-first-skatehive-post-1708563242",
    "hive_url": "https://peakd.com/@yourhiveusername/my-first-skatehive-post-1708563242",
    "transaction_id": "abc123..."
  }
}
```

---

### 2. POST `/api/v2/postFeed`

Create a snap/short post in the Skatehive feed (like a tweet).

**Request Body:**

```typescript
{
  author: string;             // Required (your Hive username)
  posting_key: string;        // Required (your Hive posting key)
  body: string;               // Required
  images?: string[];          // Optional (IPFS or regular URLs)
  video_url?: string;         // Optional (IPFS hash or 3Speak URL)
  parent_author?: string;     // Optional (default: thread author)
  parent_permlink?: string;   // Optional (default: latest snap-container)
}
```

**Example Request:**

```bash
curl -X POST https://api.skatehive.app/api/v2/postFeed \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "author": "yourhiveusername",
    "posting_key": "5K...",
    "body": "Just landed my first kickflip! 🛹 #skateboarding #progress",
    "images": [
      "https://ipfs.skatehive.app/ipfs/Qm..."
    ]
  }'
```

**Response (201 Created):**

```json
{
  "success": true,
  "data": {
    "author": "yourhiveusername",
    "permlink": "550e8400-e29b-41d4-a716-446655440000",
    "parent_author": "skatehivethread",
    "parent_permlink": "snap-container-2026-02-21",
    "url": "https://skatehive.app/post/yourhiveusername/550e8400-e29b-41d4-a716-446655440000",
    "hive_url": "https://peakd.com/@yourhiveusername/550e8400-e29b-41d4-a716-446655440000",
    "transaction_id": "def456..."
  }
}
```

---

## Error Responses

### 401 Unauthorized

```json
{
  "success": false,
  "error": "Invalid API key"
}
```

### 400 Bad Request

```json
{
  "success": false,
  "error": "Title is required"
}
```

### 429 Too Many Requests

```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "resetAt": "2026-02-21T16:30:00.000Z"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Failed to post to blockchain",
  "details": "Error message..."
}
```

---

## Best Practices

### 1. Image/Video URLs

- Use IPFS URLs for permanent content: `https://ipfs.skatehive.app/ipfs/Qm...`
- Images are automatically added to post metadata
- Videos use 3Speak iframe embedding

### 2. Hashtags

- In `postFeed`, hashtags are automatically extracted from body text
- Use `#hashtag` format in your text
- Community tag `hive-173115` is always added automatically

### 3. Beneficiaries

- Total weight must not exceed 10000 (100%)
- Weight of 1000 = 10%
- Only supported in `composeBlog` endpoint

### 4. Error Handling

- Always check `success` field in response
- Implement exponential backoff for rate limit errors
- Log `transaction_id` for debugging

---

## Example Code

### JavaScript/Node.js

```javascript
const SKATEHIVE_API_KEY = process.env.SKATEHIVE_API_KEY;

async function postToSkatehive(author, postingKey, title, body, thumbnail) {
  const response = await fetch('https://api.skatehive.app/api/v2/composeBlog', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SKATEHIVE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      author,
      posting_key: postingKey,
      title,
      body,
      thumbnail,
      tags: ['skateboarding', 'hive-173115']
    })
  });
  
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error);
  }
  
  console.log('Post created:', data.data.url);
  return data.data;
}

// Usage
postToSkatehive(
  'yourhiveusername',
  '5K...',  // Your Hive posting key
  'My Skate Session',
  'Had an awesome session today!',
  'https://ipfs.skatehive.app/ipfs/Qm...'
).catch(console.error);
```

### Python

```python
import requests
import os

SKATEHIVE_API_KEY = os.environ['SKATEHIVE_API_KEY']

def post_to_skatehive(author, posting_key, title, body, thumbnail):
    response = requests.post(
        'https://api.skatehive.app/api/v2/composeBlog',
        headers={
            'Authorization': f'Bearer {SKATEHIVE_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'author': author,
            'posting_key': posting_key,
            'title': title,
            'body': body,
            'thumbnail': thumbnail,
            'tags': ['skateboarding', 'hive-173115']
        }
    )
    
    data = response.json()
    
    if not data['success']:
        raise Exception(data['error'])
    
    print(f"Post created: {data['data']['url']}")
    return data['data']

# Usage
post_to_skatehive(
    'yourhiveusername',
    '5K...',  # Your Hive posting key
    'My Skate Session',
    'Had an awesome session today!',
    'https://ipfs.skatehive.app/ipfs/Qm...'
)
```

---

## Environment Variables

Add to Vercel or `.env.local`:

```bash
# API Keys for accessing the endpoints (comma-separated key:name pairs)
# Generate with: openssl rand -hex 32
SKATEHIVE_API_KEYS="abc123:MyBot,def456:MyApp"
```

**Note:** Users provide their own `posting_key` in each request. No shared account needed.

---

## Security Notes

1. **Never share your API key publicly**
2. **Never share your Hive posting key publicly**
3. Store API keys and posting keys in environment variables, not in code
4. Use HTTPS only
5. Implement rate limiting on your side to avoid 429 errors
6. Validate all user input before posting
7. **Important:** Each user posts with their own posting key - the API does not post on behalf of users

---

## Support

For API key requests or issues:
- Discord: https://discord.gg/skatehive
- Email: dev@skatehive.app
- GitHub: https://github.com/sktbrd/skatehive-api
