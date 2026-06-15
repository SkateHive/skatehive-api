import { NextRequest, NextResponse } from 'next/server';
import { TRANSCODE_SERVICES } from './config';

// Cache for health check results to avoid constant polling
let healthCache: { [key: string]: { isHealthy: boolean; lastCheck: number } } = {};
const HEALTH_CACHE_TTL = 30000; // 30 seconds

async function checkServiceHealth(healthUrl: string): Promise<boolean> {
  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return false;
    }
    
    const data = await response.json();
    // Check if the response indicates the service is healthy
    const isHealthy = data.ok === true || data.healthy === true || data.status === 'ok';
    const hasCapacity = !data.capacity || Number(data.capacity.available ?? 1) > 0;
    return isHealthy && hasCapacity;
  } catch (error) {
    console.error(`Health check failed for ${healthUrl}:`, error);
    return false;
  }
}

async function getHealthyService(): Promise<string | null> {
  const now = Date.now();
  
  // Sort services by priority (1 = highest priority)
  const sortedServices = [...TRANSCODE_SERVICES].sort((a, b) => a.priority - b.priority);
  
  for (const service of sortedServices) {
    const cacheKey = service.healthUrl;
    const cached = healthCache[cacheKey];
    
    // Use cached result if it's still valid
    if (cached && (now - cached.lastCheck) < HEALTH_CACHE_TTL) {
      if (cached.isHealthy) {
        console.log(`Using cached healthy service: ${service.transcodeUrl}`);
        return service.transcodeUrl;
      }
      continue;
    }
    
    // Check health status
    const isHealthy = await checkServiceHealth(service.healthUrl);
    
    // Update cache
    healthCache[cacheKey] = {
      isHealthy,
      lastCheck: now
    };
    
    if (isHealthy) {
      console.log(`Found healthy service: ${service.transcodeUrl}`);
      return service.transcodeUrl;
    }
  }
  
  return null;
}

export async function GET(request: NextRequest) {
  try {
    // Find the first healthy service based on priority
    const healthyServiceUrl = await getHealthyService();
    
    if (!healthyServiceUrl) {
      return NextResponse.json(
        { 
          error: 'No healthy transcode services available',
          message: 'All transcode services are currently unavailable. Please try again later.',
          services: TRANSCODE_SERVICES.map(s => ({
            priority: s.priority,
            name: s.name,
            healthUrl: s.healthUrl,
            transcodeUrl: s.transcodeUrl
          }))
        },
        { status: 503 }
      );
    }

    // Get query parameters to forward
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const finalUrl = queryString ? `${healthyServiceUrl}?${queryString}` : healthyServiceUrl;

    console.log(`Redirecting GET request to: ${finalUrl}`);
    
    // Redirect to the healthy service
    return NextResponse.redirect(finalUrl, { status: 302 });

  } catch (error) {
    console.error('Error in transcode GET redirect:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Find the first healthy service based on priority
    const healthyServiceUrl = await getHealthyService();
    
    if (!healthyServiceUrl) {
      return NextResponse.json(
        { 
          error: 'No healthy transcode services available',
          message: 'All transcode services are currently unavailable. Please try again later.',
          services: TRANSCODE_SERVICES.map(s => ({
            priority: s.priority,
            name: s.name,
            healthUrl: s.healthUrl,
            transcodeUrl: s.transcodeUrl
          }))
        },
        { status: 503 }
      );
    }

    // Get query parameters to forward
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const finalUrl = queryString ? `${healthyServiceUrl}?${queryString}` : healthyServiceUrl;

    // For POST requests, forward the request body and headers
    const body = await request.text();
    const headers = new Headers(request.headers);
    
    // Remove host header to avoid conflicts
    headers.delete('host');
    
    console.log(`Forwarding POST request to: ${finalUrl}`);
    
    // Forward the POST request to the healthy service
    const response = await fetch(finalUrl, {
      method: 'POST',
      headers,
      body
    });

    // Return the response from the target endpoint
    const responseData = await response.text();
    const responseHeaders = new Headers(response.headers);
    
    return new Response(responseData, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (error) {
    console.error('Error in transcode POST forward:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
