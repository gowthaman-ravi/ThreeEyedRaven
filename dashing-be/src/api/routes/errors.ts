import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// Validation Schemas
// ============================================

const errorSchema = z.object({
  id: z.string(),
  windowId: z.string().optional(),
  windowLabel: z.string().optional(),
  tabId: z.string(),
  errorType: z.string(),
  message: z.string(),
  source: z.string().optional(),
  stackTrace: z.string().optional(),
  timestamp: z.number(),
  statusCode: z.number().optional(),
  method: z.string().optional(),
  resourceType: z.string().optional(),
});

const batchErrorsSchema = z.array(errorSchema);

// ============================================
// Routes
// ============================================

/**
 * POST /sessions/:sessionId/errors
 * Batch upload errors for a session
 */
router.post('/:sessionId/errors', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const errors = batchErrorsSchema.parse(req.body);

    // Verify session exists and get windows
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { windows: true },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    // Get valid window IDs to avoid foreign key constraint errors
    const validWindowIds = new Set(session.windows.map(w => w.id));

    // Batch insert errors
    const createdErrors = await prisma.$transaction(
      errors.map(error => {
        // Only use windowId if it exists in the session's windows
        const windowId = error.windowId && validWindowIds.has(error.windowId)
          ? error.windowId
          : null;

        return prisma.error.upsert({
          where: { id: error.id },
          create: {
            id: error.id,
            sessionId,
            windowId,
            windowLabel: error.windowLabel,
            tabId: error.tabId,
            errorType: error.errorType,
            message: error.message,
            source: error.source,
            stackTrace: error.stackTrace,
            timestamp: BigInt(error.timestamp),
            statusCode: error.statusCode,
            method: error.method,
            resourceType: error.resourceType,
          },
          update: {
            // If error already exists, just update timestamp
            message: error.message,
            stackTrace: error.stackTrace,
          },
        });
      })
    );

    return res.status(201).json({
      success: true,
      count: createdErrors.length,
      message: `${createdErrors.length} errors synced`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Errors] Batch create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/errors
 * Get all errors for a session
 */
router.get('/:sessionId/errors', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { windowId, errorType, limit = '500', offset = '0' } = req.query;

    const where: Record<string, unknown> = { sessionId };
    if (windowId) {
      where.windowId = windowId;
    }
    if (errorType) {
      where.errorType = errorType;
    }

    const errors = await prisma.error.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // Serialize BigInt values
    const serializedErrors = errors.map(error => ({
      ...error,
      timestamp: error.timestamp.toString(),
    }));

    return res.json({
      success: true,
      errors: serializedErrors,
      count: errors.length,
    });
  } catch (error) {
    console.error('[Errors] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/errors/stats
 * Get error statistics for a session
 */
router.get('/:sessionId/errors/stats', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const totalCount = await prisma.error.count({
      where: { sessionId },
    });

    const byType = await prisma.error.groupBy({
      by: ['errorType'],
      where: { sessionId },
      _count: {
        errorType: true,
      },
    });

    const byStatusCode = await prisma.error.groupBy({
      by: ['statusCode'],
      where: { sessionId, statusCode: { not: null } },
      _count: {
        statusCode: true,
      },
    });

    const byWindow = await prisma.error.groupBy({
      by: ['windowId', 'windowLabel'],
      where: { sessionId },
      _count: {
        windowId: true,
      },
    });

    return res.json({
      success: true,
      stats: {
        total: totalCount,
        byType: byType.map(t => ({
          type: t.errorType,
          count: t._count.errorType,
        })),
        byStatusCode: byStatusCode.map(s => ({
          statusCode: s.statusCode,
          count: s._count.statusCode,
        })),
        byWindow: byWindow.map(w => ({
          windowId: w.windowId,
          windowLabel: w.windowLabel,
          count: w._count.windowId,
        })),
      },
    });
  } catch (error) {
    console.error('[Errors] Stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

