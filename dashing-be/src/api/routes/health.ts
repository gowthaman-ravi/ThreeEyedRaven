import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();

// Lazy-initialize Prisma to avoid connection issues during startup
let prisma: PrismaClient | null = null;

const getPrisma = () => {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
};

/**
 * GET /health
 * Health check endpoint - used by Electron app to test connection
 */
router.get('/', async (_req: Request, res: Response) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      api: 'up',
      database: 'unknown',
    },
  };

  try {
    // Check database connection
    await getPrisma().$queryRaw`SELECT 1`;
    healthCheck.services.database = 'up';
  } catch (error) {
    healthCheck.services.database = 'down';
    healthCheck.status = 'degraded';
  }

  const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthCheck);
});

/**
 * GET /health/ready
 * Readiness check - are all services ready to handle requests?
 */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    res.status(200).json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false, error: 'Database not ready' });
  }
});

/**
 * GET /health/live
 * Liveness check - is the server alive?
 */
router.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ alive: true });
});

export default router;

