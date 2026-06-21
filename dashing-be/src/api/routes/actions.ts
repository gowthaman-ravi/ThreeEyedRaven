import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// Validation Schemas
// ============================================

const actionSchema = z.object({
  id: z.string(),
  windowId: z.string().optional(),
  windowLabel: z.string().optional(),
  tabId: z.string(),
  tabUrl: z.string().optional(),
  tabTitle: z.string().optional(),
  actionType: z.string(),
  timestamp: z.number(),
  elementSelector: z.string().optional(),
  elementXpath: z.string().optional(),
  elementTag: z.string().optional(),
  payload: z.record(z.any()),
});

const batchActionsSchema = z.array(actionSchema);

// ============================================
// Routes
// ============================================

/**
 * POST /sessions/:sessionId/actions
 * Batch upload actions for a session
 */
router.post('/:sessionId/actions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const actions = batchActionsSchema.parse(req.body);

    // Verify session exists
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

    // Batch insert actions using createMany for efficiency
    const createdActions = await prisma.$transaction(
      actions.map(action => {
        // Only use windowId if it exists in the session's windows
        const windowId = action.windowId && validWindowIds.has(action.windowId) 
          ? action.windowId 
          : null;
        
        return prisma.action.upsert({
          where: { id: action.id },
          create: {
            id: action.id,
            sessionId,
            windowId,
            windowLabel: action.windowLabel,
            tabId: action.tabId,
            tabUrl: action.tabUrl,
            tabTitle: action.tabTitle,
            actionType: action.actionType,
            timestamp: BigInt(action.timestamp),
            elementSelector: action.elementSelector,
            elementXpath: action.elementXpath,
            elementTag: action.elementTag,
            payload: action.payload,
          },
          update: {
            // If action already exists, update these fields
            tabUrl: action.tabUrl,
            tabTitle: action.tabTitle,
            payload: action.payload,
          },
        });
      })
    );

    return res.status(201).json({
      success: true,
      count: createdActions.length,
      message: `${createdActions.length} actions synced`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Actions] Batch create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/actions
 * Get all actions for a session
 */
router.get('/:sessionId/actions', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { windowId, actionType, limit = '500', offset = '0' } = req.query;

    const where: Record<string, unknown> = { sessionId };
    if (windowId) {
      where.windowId = windowId;
    }
    if (actionType) {
      where.actionType = actionType;
    }

    const actions = await prisma.action.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // Serialize BigInt values
    const serializedActions = actions.map(action => ({
      ...action,
      timestamp: action.timestamp.toString(),
    }));

    return res.json({
      success: true,
      actions: serializedActions,
      count: actions.length,
    });
  } catch (error) {
    console.error('[Actions] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/actions/stats
 * Get action statistics for a session
 */
router.get('/:sessionId/actions/stats', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const totalCount = await prisma.action.count({
      where: { sessionId },
    });

    const byType = await prisma.action.groupBy({
      by: ['actionType'],
      where: { sessionId },
      _count: {
        actionType: true,
      },
    });

    const byWindow = await prisma.action.groupBy({
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
          type: t.actionType,
          count: t._count.actionType,
        })),
        byWindow: byWindow.map(w => ({
          windowId: w.windowId,
          windowLabel: w.windowLabel,
          count: w._count.windowId,
        })),
      },
    });
  } catch (error) {
    console.error('[Actions] Stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

