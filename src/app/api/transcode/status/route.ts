import { NextRequest, NextResponse } from 'next/server';
import { TRANSCODE_SERVICES, ServiceStatus } from '../config';

async function checkServiceHealth(healthUrl: string): Promise<{
  isHealthy: boolean;
  responseTime?: number;
  capacity?: ServiceStatus['capacity'];
  error?: string;
}> {
  const startTime = Date.now();
  
  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    if (!response.ok) {
      return {
        isHealthy: false,
        responseTime,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    const data = await response.json();
    const rawHealthy = data.ok === true || data.healthy === true || data.status === 'ok';
    const capacity = data.capacity && typeof data.capacity === 'object'
      ? {
          active: Number(data.capacity.active ?? 0),
          max: Number(data.capacity.max ?? 1),
          available: Number(data.capacity.available ?? 1)
        }
      : undefined;
    const hasCapacity = !capacity || capacity.available > 0;
    const isHealthy = rawHealthy && hasCapacity;
    
    return {
      isHealthy,
      responseTime,
      capacity,
      error: isHealthy ? undefined : (rawHealthy && !hasCapacity ? 'Worker at capacity' : 'Health check returned false')
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      isHealthy: false,
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}



export async function GET(request: NextRequest) {
  try {
    const startTime = Date.now();

    const orderedServices = [...TRANSCODE_SERVICES].sort((a, b) => a.priority - b.priority);
    const serviceStatuses: ServiceStatus[] = await Promise.all(
      orderedServices.map(async (service) => {
        const healthResult = await checkServiceHealth(service.healthUrl);

        return {
          priority: service.priority,
          name: service.name,
          healthUrl: service.healthUrl,
          transcodeUrl: service.transcodeUrl,
          isHealthy: healthResult.isHealthy,
          responseTime: healthResult.responseTime,
          capacity: healthResult.capacity,
          error: healthResult.error,
          lastChecked: new Date().toISOString()
        };
      })
    );

    const activeService = serviceStatuses.find((service) => service.isHealthy);
    const totalResponseTime = Date.now() - startTime;
    const healthyCount = serviceStatuses.filter(s => s.isHealthy).length;
    const totalCount = serviceStatuses.length;
    const systemStatus = healthyCount === totalCount
      ? 'operational'
      : healthyCount > 0
        ? 'degraded'
        : 'down';
    
    const response = {
      status: systemStatus,
      timestamp: new Date().toISOString(),
      totalResponseTime: `${totalResponseTime}ms`,
      summary: {
        healthyServices: healthyCount,
        totalServices: totalCount,
        systemStatus,
        activeService: activeService ? {
          name: activeService.name,
          priority: activeService.priority,
          transcodeUrl: activeService.transcodeUrl,
          responseTime: `${activeService.responseTime}ms`,
          capacity: activeService.capacity
        } : null
      },
      services: serviceStatuses.sort((a, b) => a.priority - b.priority)
    };
    
    // Return different HTTP status based on system health
    const httpStatus = healthyCount > 0 ? 200 : 503;
    
    return NextResponse.json(response, { status: httpStatus });
    
  } catch (error) {
    console.error('Error in transcode status check:', error);
    return NextResponse.json(
      { 
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Failed to check service status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
