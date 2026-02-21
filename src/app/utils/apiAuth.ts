/**
 * API Authentication Helper
 * 
 * Validates API keys for bot/app access to posting endpoints
 */

import { NextRequest } from 'next/server';

export interface AuthResult {
  isValid: boolean;
  error?: string;
  apiKeyName?: string;
}

/**
 * Valid API keys for posting endpoints
 * 
 * Format: { "key": "description/app name" }
 * 
 * To add a new key:
 * 1. Generate: openssl rand -hex 32
 * 2. Add to .env.local: SKATEHIVE_API_KEYS="key1:AppName,key2:BotName"
 * 3. Add to this mapping
 */
const getValidApiKeys = (): Map<string, string> => {
  const keys = new Map<string, string>();
  
  // Load from environment variable
  const envKeys = process.env.SKATEHIVE_API_KEYS || '';
  
  if (envKeys) {
    envKeys.split(',').forEach(entry => {
      const [key, name] = entry.split(':');
      if (key && name) {
        keys.set(key.trim(), name.trim());
      }
    });
  }
  
  return keys;
};

/**
 * Validates API key from request headers
 * 
 * Expects header: Authorization: Bearer <api_key>
 */
export function validateApiKey(request: NextRequest): AuthResult {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) {
    return {
      isValid: false,
      error: 'Missing authorization header'
    };
  }
  
  // Extract Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return {
      isValid: false,
      error: 'Invalid authorization format. Use: Bearer <api_key>'
    };
  }
  
  const apiKey = parts[1];
  const validKeys = getValidApiKeys();
  
  if (!validKeys.has(apiKey)) {
    return {
      isValid: false,
      error: 'Invalid API key'
    };
  }
  
  return {
    isValid: true,
    apiKeyName: validKeys.get(apiKey)
  };
}

/**
 * Rate limiting (simple in-memory implementation)
 * 
 * In production, use Redis or similar
 */
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  apiKey: string,
  maxRequests: number = 100,
  windowMs: number = 60000 // 1 minute
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateLimitMap.get(apiKey);
  
  // Clean up old entries
  if (existing && now > existing.resetAt) {
    rateLimitMap.delete(apiKey);
  }
  
  const current = rateLimitMap.get(apiKey) || {
    count: 0,
    resetAt: now + windowMs
  };
  
  if (current.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt
    };
  }
  
  current.count++;
  rateLimitMap.set(apiKey, current);
  
  return {
    allowed: true,
    remaining: maxRequests - current.count,
    resetAt: current.resetAt
  };
}
