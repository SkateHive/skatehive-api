# Skatehive Leaderboard API v2

## Overview

The Skatehive Leaderboard API v2 provides comprehensive access to the Skatehive community data, including user profiles, content feeds, leaderboards, and social interactions. This API is built for the skateboarding community on the Hive blockchain, specifically targeting the hive-173115 community.

## Base URL

```
http://localhost:3000/api/v2
```

## API Endpoint

`GET /api/v2`

## Description

This endpoint provides an overview of the API v2 structure and available endpoints. It serves as the main directory for all v2 functionality.

## Request Example

```bash
curl -X GET "http://localhost:3000/api/v2"
```

## Response Format

```json
{
  "success": true,
  "message": "Welcome to the Skatehive Leaderboard API v2",
  "version": "2.0.0",
  "description": "Comprehensive API for Skatehive community data and interactions",
  "endpoints": {
    "core": {
      "leaderboard": "/api/v2/leaderboard",
      "profile": "/api/v2/profile",
      "profile_user": "/api/v2/profile/{username}"
    },
    "social": {
      "followers": "/api/v2/followers/{username}",
      "following": "/api/v2/following/{username}"
    },
    "content": {
      "feed": "/api/v2/feed",
      "feed_user": "/api/v2/feed/{username}",
      "feed_trending": "/api/v2/feed/trending",
      "skatesnaps": "/api/v2/skatesnaps",
      "skatesnaps_user": "/api/v2/skatesnaps/{username}",
      "skatesnaps_trending": "/api/v2/skatesnaps/trending"
    },
    "engagement": {
      "comments": "/api/v2/comments",
      "vote": "/api/v2/vote",
      "createpost": "/api/v2/createpost"
    },
    "economy": {
      "balance": "/api/v2/balance/{username}",
      "market": "/api/v2/market"
    },
    "utility": {
      "skatespots": "/api/v2/skatespots"
    }
  },
  "documentation": {
    "swagger": "/docs",
    "readme": "https://github.com/sktbrd/leaderboard-api"
  },
  "status": {
    "uptime": "99.9%",
    "lastUpdated": "2024-01-15T15:00:00.000Z",
    "version": "2.0.0"
  }
}
```

## API Architecture

### Core Features

- **Hive Blockchain Integration**: Direct access to hive-173115 community data
- **Real-time Updates**: Live data from the Hive blockchain
- **Comprehensive Profiles**: User stats, reputation, and activity
- **Social Graph**: Followers, following, and community connections
- **Content Management**: Posts, comments, votes, and interactions
- **Gamification**: Leaderboards, scores, and community rankings

### Data Sources

- **Primary**: HAFSQL Database (Hive blockchain data)
- **Secondary**: HiveClient (resource credits, voting power)
- **Legacy**: Supabase (V1 leaderboard data)
- **External**: Ethereum blockchain for token data

## Endpoint Categories

### 🏆 Core Endpoints

| Endpoint                     | Method | Description                    | Status     |
| ---------------------------- | ------ | ------------------------------ | ---------- |
| `/api/v2`                    | GET    | API overview and directory     | ✅ Working |
| `/api/v2/leaderboard`        | GET    | Community leaderboard rankings | 🔄 Testing |
| `/api/v2/profile`            | GET    | All user profiles              | 🔄 Testing |
| `/api/v2/profile/{username}` | GET    | Specific user profile          | ✅ Working |

### 👥 Social Endpoints

| Endpoint                       | Method | Description           | Status     |
| ------------------------------ | ------ | --------------------- | ---------- |
| `/api/v2/followers/{username}` | GET    | User's followers list | 🔄 Testing |
| `/api/v2/following/{username}` | GET    | Users being followed  | 🔄 Testing |

### 📱 Content Endpoints

| Endpoint                        | Method | Description                | Status     |
| ------------------------------- | ------ | -------------------------- | ---------- |
| `/api/v2/feed`                  | GET    | General community feed     | 🔄 Testing |
| `/api/v2/feed/{username}`       | GET    | User-specific feed         | 🔄 Testing |
| `/api/v2/feed/trending`         | GET    | Trending community content | 🔄 Testing |
| `/api/v2/skatesnaps`            | GET    | Short-form skate content   | 🔄 Testing |
| `/api/v2/skatesnaps/{username}` | GET    | User's skate snaps         | 🔄 Testing |
| `/api/v2/skatesnaps/trending`   | GET    | Trending skate snaps       | 🔄 Testing |

### 💬 Engagement Endpoints

| Endpoint             | Method   | Description                | Status     |
| -------------------- | -------- | -------------------------- | ---------- |
| `/api/v2/comments`   | GET/POST | Comments data and creation | 🔄 Testing |
| `/api/v2/vote`       | POST     | Cast votes on content      | 🔄 Testing |
| `/api/v2/createpost` | POST     | Create new posts           | 🔄 Testing |

### 💰 Economy Endpoints

| Endpoint                     | Method | Description           | Status     |
| ---------------------------- | ------ | --------------------- | ---------- |
| `/api/v2/balance/{username}` | GET    | User wallet balance   | 🔄 Testing |
| `/api/v2/market`             | GET    | Market and token data | 🔄 Testing |

### 📤 IPFS & Media Endpoints

| Endpoint                    | Method | Description                              | Status     | Auth Required |
| --------------------------- | ------ | ---------------------------------------- | ---------- | ------------- |
| `/api/v2/ipfs/upload`       | POST   | Upload images/videos to Skatehive IPFS   | ✅ Working | Yes (API Key) |

#### IPFS Upload Endpoint

Upload images and videos to Skatehive IPFS storage via Pinata.

**Authentication**: API key required (Bearer token)

**Request Format**: `multipart/form-data`

**Fields**:
- `file` (required): Image or video file (max 100MB)
- `creator` (optional): Username of uploader (defaults to API key name)

**Supported File Types**:
- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
- **Videos**: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`

**Example**:
```bash
curl -X POST https://api.skatehive.app/api/v2/ipfs/upload \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "file=@skatevideo.mp4" \
  -F "creator=myusername"
```

**Response**:
```json
{
  "success": true,
  "ipfsHash": "QmYH8ZqN...",
  "ipfsUrl": "https://ipfs.skatehive.app/ipfs/QmYH8ZqN...",
  "ipfsUri": "ipfs://QmYH8ZqN...",
  "filename": "skatevideo.mp4",
  "fileSize": 15234567,
  "mediaType": "video",
  "creator": "myusername"
}
```

**Rate Limits**:
- 100 uploads per hour per API key
- 50 uploads per hour per IP (without key)

## Testing Status

Based on live testing with real Skatehive community data:

### ✅ Confirmed Working

- `GET /api/v2` - Returns API overview (HTTP 200)
- `GET /api/v2/profile/{username}` - User profile data (proper 404 for non-existent users)

### 🔄 Testing in Progress

- Database-dependent endpoints require HAFSQL connection
- Community-specific data needs hive-173115 filtering
- User-specific endpoints need valid Skatehive community members

### Test Data

Use these verified community usernames for testing:

- `xvlad` - Active test user
- `gnars` - Community founder
- `steemskate` - Long-time member

## Status Code

- **200 OK**: Successfully returns API overview
- **500 Internal Server Error**: Database connection issues

## Use Cases

- **API Discovery**: Explore available v2 endpoints
- **Integration Reference**: Get endpoint URLs for development
- **Health Monitoring**: Check API availability and status
- **Documentation**: Understand API structure and capabilities

## Community Focus

This API is specifically designed for the **Skatehive community (hive-173115)** on the Hive blockchain, providing skateboarding-focused features and data.
