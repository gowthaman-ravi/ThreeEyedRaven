import { Router, Request, Response } from 'express';
import { PrismaClient, SessionStatus } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// Validation Schemas
// ============================================

const createSessionSchema = z.object({
  id: z.string().min(1), // Accept any non-empty string ID (Electron uses custom format)
  name: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ENDED', 'RECORDING']).optional(), // Include all Electron statuses
  startTime: z.number().optional(), // Make optional, will use startedAt as fallback
  startedAt: z.number().optional(), // Electron app uses this
  endTime: z.number().optional().nullable(),
  endedAt: z.number().optional().nullable(), // Electron app uses this
  metadata: z.record(z.any()).optional(),
  windows: z.array(z.object({
    id: z.string().min(1), // Accept any non-empty string ID
    label: z.string(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    createdAt: z.number(),
    closedAt: z.number().optional().nullable(),
  })).optional(),
});

const updateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(),
  endTime: z.number().optional(),
  metadata: z.record(z.any()).optional(),
});

// ============================================
// Routes
// ============================================

/**
 * POST /sessions
 * Create or update a session (upsert for sync)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    console.log('[Sessions] Received payload:', JSON.stringify(req.body, null, 2));
    const data = createSessionSchema.parse(req.body);
    const organizationId = req.headers['x-organization-id'] as string | undefined;
    const userId = req.headers['x-user-id'] as string | undefined;

    // Handle field name differences between Electron and API
    const startTime = data.startTime || data.startedAt || Date.now();
    const endTime = data.endTime || data.endedAt;
    
    // Map status from Electron format to DB format
    let status: SessionStatus = 'ACTIVE';
    if (data.status) {
      const statusMap: Record<string, SessionStatus> = {
        'ACTIVE': 'ACTIVE',
        'RECORDING': 'ACTIVE',
        'PAUSED': 'PAUSED',
        'COMPLETED': 'COMPLETED',
        'ENDED': 'COMPLETED',
      };
      status = statusMap[data.status.toUpperCase()] || 'ACTIVE';
    }

    // Upsert session
    const session = await prisma.session.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        name: data.name,
        status,
        startTime: BigInt(startTime),
        endTime: endTime ? BigInt(endTime) : null,
        metadata: data.metadata || {},
        organizationId,
        userId,
      },
      update: {
        name: data.name,
        status,
        endTime: endTime ? BigInt(endTime) : undefined,
        metadata: data.metadata || undefined,
      },
    });

    // Upsert windows if provided
    if (data.windows && data.windows.length > 0) {
      for (const window of data.windows) {
        await prisma.sessionWindow.upsert({
          where: { id: window.id },
          create: {
            id: window.id,
            sessionId: session.id,
            label: window.label,
            status: window.status || 'OPEN',
            createdAt: BigInt(window.createdAt),
            closedAt: window.closedAt ? BigInt(window.closedAt) : null,
          },
          update: {
            label: window.label,
            status: window.status || undefined,
            closedAt: window.closedAt ? BigInt(window.closedAt) : undefined,
          },
        });
      }
    }

    // Serialize BigInt values for JSON response
    const serializedSession = {
      ...session,
      startTime: session.startTime.toString(),
      endTime: session.endTime?.toString() || null,
    };

    return res.status(201).json({
      success: true,
      session: serializedSession,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[Sessions] Validation error:', JSON.stringify(error.errors, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        details: error.errors,
      });
    }
    console.error('[Sessions] Create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions
 * List all sessions for the authenticated organization
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const organizationId = req.headers['x-organization-id'] as string | undefined;
    const { status, limit = '50', offset = '0' } = req.query;

    const where: Record<string, unknown> = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }
    if (status) {
      where.status = status as SessionStatus;
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        windows: true,
        _count: {
          select: {
            actions: true,
            errors: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // Serialize BigInt values
    const serializedSessions = sessions.map(session => ({
      ...session,
      startTime: session.startTime.toString(),
      endTime: session.endTime?.toString() || null,
      windows: session.windows.map(w => ({
        ...w,
        createdAt: w.createdAt.toString(),
        closedAt: w.closedAt?.toString() || null,
      })),
    }));

    return res.json({
      success: true,
      sessions: serializedSessions,
      count: sessions.length,
    });
  } catch (error) {
    console.error('[Sessions] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:id
 * Get a single session with all details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        windows: true,
        _count: {
          select: {
            actions: true,
            errors: true,
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    // Serialize BigInt values
    const serializedSession = {
      ...session,
      startTime: session.startTime.toString(),
      endTime: session.endTime?.toString() || null,
      windows: session.windows.map(w => ({
        ...w,
        createdAt: w.createdAt.toString(),
        closedAt: w.closedAt?.toString() || null,
      })),
    };

    return res.json({
      success: true,
      session: serializedSession,
    });
  } catch (error) {
    console.error('[Sessions] Get error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PATCH /sessions/:id
 * Update a session
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateSessionSchema.parse(req.body);

    const session = await prisma.session.update({
      where: { id },
      data: {
        name: data.name,
        status: data.status as SessionStatus | undefined,
        endTime: data.endTime ? BigInt(data.endTime) : undefined,
        metadata: data.metadata,
      },
    });

    const serializedSession = {
      ...session,
      startTime: session.startTime.toString(),
      endTime: session.endTime?.toString() || null,
    };

    return res.json({
      success: true,
      session: serializedSession,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Sessions] Update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * DELETE /sessions/:id
 * Delete a session and all associated data
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.session.delete({
      where: { id },
    });

    return res.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error) {
    console.error('[Sessions] Delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

