import { Request, Response, NextFunction } from 'express';

/**
 * Request Logger Middleware
 * Logs incoming requests and response times
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  const requestId = generateRequestId();

  // Add request ID to headers for tracing
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Log request
  console.log(`[${new Date().toISOString()}] ${requestId} → ${req.method} ${req.path}`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'WARN' : 'INFO';
    
    console.log(
      `[${new Date().toISOString()}] ${requestId} ← ${res.statusCode} (${duration}ms) [${logLevel}]`
    );
  });

  next();
}

/**
 * Generate a short unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Detailed request logger (for debugging)
 */
export function detailedRequestLogger(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('[Request Details]', {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: {
        'content-type': req.headers['content-type'],
        'x-api-key': req.headers['x-api-key'] ? '[REDACTED]' : undefined,
        'x-organization-id': req.headers['x-organization-id'],
        'user-agent': req.headers['user-agent'],
      },
      body: req.method !== 'GET' ? summarizeBody(req.body) : undefined,
    });
  }

  next();
}

/**
 * Summarize request body for logging (avoid logging sensitive/large data)
 */
function summarizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (Array.isArray(body)) {
    return `[Array with ${body.length} items]`;
  }

  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > 100) {
      summary[key] = `[String: ${value.length} chars]`;
    } else if (Array.isArray(value)) {
      summary[key] = `[Array: ${value.length} items]`;
    } else if (typeof value === 'object' && value !== null) {
      summary[key] = `[Object: ${Object.keys(value as object).length} keys]`;
    } else {
      summary[key] = value;
    }
  }

  return summary;
}

