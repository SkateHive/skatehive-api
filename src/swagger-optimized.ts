import { commonSchemas, createEndpoint } from './swagger-schemas';

// Optimized swagger document with reusable components
export const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Skatehive API',
    version: '2.0.0',
    description: 'Complete API documentation for Skatehive Leaderboard with V1 and V2 endpoints',
  },
  tags: [
    { name: 'V1 Legacy', description: 'Legacy V1 API endpoints' },
    { name: 'V2 Core', description: 'V2 Core API endpoints - main functionality' },
    { name: 'V2 Feed', description: 'V2 Feed endpoints - content feeds and posts' },
    { name: 'V2 Social', description: 'V2 Social endpoints - followers, following, profiles' },
    { name: 'V2 Wallet', description: 'V2 Wallet endpoints - balances and financial data' },
    { name: 'V2 SkateSnaps', description: 'V2 SkateSnaps endpoints - short-form content' },
    { name: 'V2 Activity', description: 'V2 Activity endpoints - user activities and stats' },
    { name: 'V2 Content', description: 'V2 Content endpoints - magazines, skatefeed, and content management' },
    { name: 'V2 Utilities', description: 'V2 Utility endpoints - voting, comments, spots' },
    { name: 'Cron Jobs', description: 'Scheduled task endpoints for data updates' }
  ],
  ...commonSchemas,
  paths: {
    // V1 Legacy Endpoints
    '/api/skatehive': {
      get: createEndpoint({
        tags: ['V1 Legacy'],
        summary: 'Fetch leaderboard data from Supabase'
      })
    },
    '/api/ethHelpers': {
      get: createEndpoint({
        tags: ['V1 Legacy'],
        summary: 'Get Ethereum-related data',
        parameters: [
          {
            in: 'query',
            name: 'address',
            required: true,
            schema: { type: 'string' },
            description: 'Ethereum wallet address'
          },
          {
            in: 'query',
            name: 'method',
            required: true,
            schema: {
              type: 'string',
              enum: ['balance', 'votes', 'skatehiveNFTBalance']
            },
            description: 'Method to call'
          }
        ]
      })
    },
    '/api/leaderboard': {
      get: createEndpoint({
        tags: ['V1 Legacy'],
        summary: 'Fetch and store leaderboard data',
        parameters: [{
          in: 'query',
          name: 'community',
          required: false,
          schema: { type: 'string' },
          description: 'Community name to filter by'
        }]
      }),
      post: createEndpoint({
        tags: ['V1 Legacy'],
        summary: 'Fetch and store leaderboard data for a community'
      })
    },

    // V2 Core Endpoints
    '/api/v2': {
      get: createEndpoint({
        tags: ['V2 Core'],
        summary: 'V2 API overview and available endpoints'
      })
    },
    '/api/v2/leaderboard': {
      get: createEndpoint({
        tags: ['V2 Core'],
        summary: 'Get V2 leaderboard data'
      })
    },
    '/api/v2/highest-paid': {
      get: createEndpoint({
        tags: ['V2 Core'],
        summary: 'Get highest paid posts of all time',
        description: 'Returns the highest paid posts ever from the SkateHive community, sorted by total payout. Supports filtering by time period, minimum payout, and author.',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          {
            in: 'query',
            name: 'days',
            required: false,
            schema: { type: 'integer' },
            description: 'Filter posts from the last X days. Leave empty for all-time (GOAT) posts.'
          },
          {
            in: 'query',
            name: 'minPayout',
            required: false,
            schema: { type: 'number' },
            description: 'Minimum total payout filter (in USD/HBD)'
          },
          {
            in: 'query',
            name: 'author',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by author username (partial match supported)'
          },
          {
            in: 'query',
            name: 'community',
            required: false,
            schema: { type: 'string', default: 'hive-173115' },
            description: 'Community code to filter by'
          }
        ]
      })
    },

    // V2 Profile Endpoints
    '/api/v2/profile': {
      get: createEndpoint({
        tags: ['V2 Social'],
        summary: 'Get all profiles'
      })
    },
    '/api/v2/profile/{username}': {
      get: createEndpoint({
        tags: ['V2 Social'],
        summary: 'Get specific user profile by username path',
        parameters: [{ $ref: '#/components/parameters/UsernameParam' }]
      })
    },

    // V2 Feed Endpoints
    '/api/v2/feed': {
      get: createEndpoint({
        tags: ['V2 Feed'],
        summary: 'Get general feed',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/feed/{username}': {
      get: createEndpoint({
        tags: ['V2 Feed'],
        summary: 'Get user-specific feed',
        parameters: [
          { $ref: '#/components/parameters/UsernameParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/feed/{username}/following': {
      get: createEndpoint({
        tags: ['V2 Feed'],
        summary: 'Get feed from users that the specified user is following',
        parameters: [
          { $ref: '#/components/parameters/UsernameParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/feed/trending': {
      get: createEndpoint({
        tags: ['V2 Feed'],
        summary: 'Get trending posts feed',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },

    // V2 Social Endpoints
    '/api/v2/followers/{username}': {
      get: createEndpoint({
        tags: ['V2 Social'],
        summary: 'Get user followers',
        parameters: [{ $ref: '#/components/parameters/UsernameParam' }]
      })
    },
    '/api/v2/following/{username}': {
      get: createEndpoint({
        tags: ['V2 Social'],
        summary: 'Get users that a user is following',
        parameters: [{ $ref: '#/components/parameters/UsernameParam' }]
      })
    },

    // V2 Wallet Endpoints
    '/api/v2/balance/{username}': {
      get: createEndpoint({
        tags: ['V2 Wallet'],
        summary: 'Get user balance information',
        parameters: [{ $ref: '#/components/parameters/UsernameParam' }]
      })
    },
    '/api/v2/balance/{username}/rewards': {
      get: createEndpoint({
        tags: ['V2 Wallet'],
        summary: 'Get user rewards information',
        parameters: [{ $ref: '#/components/parameters/UsernameParam' }]
      })
    },

    // V2 SkateSnaps Endpoints
    '/api/v2/skatesnaps': {
      get: createEndpoint({
        tags: ['V2 SkateSnaps'],
        summary: 'Get all skate snaps',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/skatesnaps/{username}': {
      get: createEndpoint({
        tags: ['V2 SkateSnaps'],
        summary: 'Get user-specific skate snaps',
        parameters: [
          { $ref: '#/components/parameters/UsernameParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/skatesnaps/{username}/following': {
      get: createEndpoint({
        tags: ['V2 SkateSnaps'],
        summary: 'Get skate snaps from users that the specified user is following',
        parameters: [
          { $ref: '#/components/parameters/UsernameParam' },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/skatesnaps/trending': {
      get: createEndpoint({
        tags: ['V2 SkateSnaps'],
        summary: 'Get trending skate snaps',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },

    // V2 Activity Endpoints
    '/api/v2/activity/posts': {
      get: createEndpoint({
        tags: ['V2 Activity'],
        summary: 'Get user post activity',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/activity/snaps': {
      get: createEndpoint({
        tags: ['V2 Activity'],
        summary: 'Get user snaps activity',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },

    // V2 Content Endpoints
    '/api/v2/magazine': {
      get: createEndpoint({
        tags: ['V2 Content'],
        summary: 'Get magazine content',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },
    '/api/v2/skatefeed': {
      get: createEndpoint({
        tags: ['V2 Content'],
        summary: 'Get skatefeed content',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },

    // V2 Utility Endpoints
    '/api/v2/vote': {
      post: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Cast a vote on content'
      })
    },
    '/api/v2/comments': {
      get: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Get comments',
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      }),
      post: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Create a new comment'
      })
    },
    '/api/v2/createpost': {
      post: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Create a new post'
      })
    },
    '/api/v2/market': {
      get: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Get market data'
      })
    },
    '/api/v2/skatespots': {
      get: createEndpoint({
        tags: ['V2 Utilities'],
        summary: 'Get skate spots information',
        parameters: [
          {
            in: 'query',
            name: 'location',
            required: false,
            schema: { type: 'string' },
            description: 'Filter by location'
          },
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' }
        ]
      })
    },

    // Cron Job Endpoints
    '/api/cron/update': {
      post: createEndpoint({
        tags: ['Cron Jobs'],
        summary: 'Trigger manual data update (cron job)'
      })
    },
    '/api/cron/v2': {
      post: createEndpoint({
        tags: ['Cron Jobs'],
        summary: 'Trigger V2 data update (cron job)'
      })
    },
    '/api/cron/v2/leaderboard': {
      post: createEndpoint({
        tags: ['Cron Jobs'],
        summary: 'Trigger V2 leaderboard update (cron job)'
      })
    },
    '/api/cron/highest-paid': {
      get: createEndpoint({
        tags: ['Cron Jobs'],
        summary: 'Update highest paid posts cache',
        description: 'Refreshes the in-memory cache of highest paid posts. Called automatically every 15 minutes by Vercel Cron.',
        parameters: [
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: { type: 'integer', default: 500, maximum: 1000 },
            description: 'Number of posts to cache (max: 1000)'
          },
          {
            in: 'query',
            name: 'community',
            required: false,
            schema: { type: 'string', default: 'hive-173115' },
            description: 'Community code'
          }
        ]
      })
    }
  }
};
