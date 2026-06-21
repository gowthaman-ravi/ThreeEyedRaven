import { Router, Request, Response } from 'express';
import { PrismaClient, TestCategory, TestPriority, TestStatus } from '@prisma/client';
import { z } from 'zod';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// Validation Schemas
// ============================================

const testCaseSchema = z.object({
  id: z.string(),
  fieldId: z.string().optional().nullable(),
  fieldName: z.string(),
  fieldSelector: z.string().optional().nullable(),
  category: z.enum(['REQUIRED', 'BOUNDARY', 'NEGATIVE', 'FORMAT', 'SECURITY', 'ACCESSIBILITY']),
  name: z.string(),
  description: z.string().optional().nullable(),
  testValue: z.string().optional().nullable(),
  expectedResult: z.string().optional().nullable(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional().nullable().default('MEDIUM'),
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'SKIPPED']).optional().nullable().default('PENDING'),
  notes: z.string().optional().nullable(),
  playwrightCode: z.string().optional().nullable(),
  prerequisiteSteps: z.array(z.any()).optional().nullable(),  // Array of TestStep objects
  testActionStep: z.any().optional().nullable(),               // Single TestStep object
  createdAt: z.number().optional().nullable(),
  updatedAt: z.number().optional().nullable(),
});

const batchTestCasesSchema = z.array(testCaseSchema);

const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'SKIPPED']),
  notes: z.string().optional(),
});

// ============================================
// Routes
// ============================================

/**
 * POST /sessions/:sessionId/test-cases
 * Batch upload/sync test cases for a session
 */
router.post('/:sessionId/test-cases', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    console.log('[TestCases] Received payload sample:', JSON.stringify(req.body?.[0] || {}, null, 2));
    const testCases = batchTestCasesSchema.parse(req.body);

    // Verify session exists
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    // Batch upsert test cases
    const upsertedCases = await prisma.$transaction(
      testCases.map(tc => 
        prisma.testCase.upsert({
          where: { id: tc.id },
          create: {
            id: tc.id,
            sessionId,
            fieldId: tc.fieldId,
            fieldName: tc.fieldName,
            fieldSelector: tc.fieldSelector,
            category: tc.category as TestCategory,
            name: tc.name,
            description: tc.description,
            testValue: tc.testValue,
            expectedResult: tc.expectedResult,
            priority: (tc.priority || 'MEDIUM') as TestPriority,
            status: (tc.status || 'PENDING') as TestStatus,
            notes: tc.notes,
            playwrightCode: tc.playwrightCode,
            prerequisiteSteps: tc.prerequisiteSteps || undefined,
            testActionStep: tc.testActionStep || undefined,
          },
          update: {
            status: tc.status as TestStatus,
            notes: tc.notes,
            // Update these fields if they changed
            fieldName: tc.fieldName,
            description: tc.description,
            testValue: tc.testValue,
            expectedResult: tc.expectedResult,
            playwrightCode: tc.playwrightCode,
            prerequisiteSteps: tc.prerequisiteSteps || undefined,
            testActionStep: tc.testActionStep || undefined,
          },
        })
      )
    );

    return res.status(201).json({
      success: true,
      count: upsertedCases.length,
      message: `${upsertedCases.length} test cases synced`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('[TestCases] Validation error:', JSON.stringify(error.errors, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[TestCases] Batch create error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/test-cases
 * Get all test cases for a session
 */
router.get('/:sessionId/test-cases', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { status, priority, category, limit = '500', offset = '0' } = req.query;

    const where: Record<string, unknown> = { sessionId };
    
    if (status) {
      where.status = status as string;
    }
    if (priority) {
      where.priority = priority as string;
    }
    if (category) {
      where.category = category as string;
    }

    const testCases = await prisma.testCase.findMany({
      where,
      orderBy: [
        { priority: 'asc' }, // CRITICAL first
        { createdAt: 'asc' },
      ],
      take: parseInt(limit as string, 10),
      skip: parseInt(offset as string, 10),
    });

    // Serialize timestamps
    const serialized = testCases.map(tc => ({
      ...tc,
      createdAt: tc.createdAt.toISOString(),
      updatedAt: tc.updatedAt.toISOString(),
      syncedAt: tc.syncedAt.toISOString(),
    }));

    return res.json({
      success: true,
      testCases: serialized,
      count: testCases.length,
    });
  } catch (error) {
    console.error('[TestCases] List error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /sessions/:sessionId/test-cases/stats
 * Get test case statistics for a session
 */
router.get('/:sessionId/test-cases/stats', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const [total, byStatus, byPriority, byCategory] = await Promise.all([
      prisma.testCase.count({ where: { sessionId } }),
      prisma.testCase.groupBy({
        by: ['status'],
        where: { sessionId },
        _count: { status: true },
      }),
      prisma.testCase.groupBy({
        by: ['priority'],
        where: { sessionId },
        _count: { priority: true },
      }),
      prisma.testCase.groupBy({
        by: ['category'],
        where: { sessionId },
        _count: { category: true },
      }),
    ]);

    // Transform to expected format
    const statusMap: Record<string, number> = {
      PENDING: 0,
      PASSED: 0,
      FAILED: 0,
      SKIPPED: 0,
    };
    byStatus.forEach(s => {
      statusMap[s.status] = s._count.status;
    });

    const priorityMap: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    byPriority.forEach(p => {
      priorityMap[p.priority] = p._count.priority;
    });

    const categoryMap: Record<string, number> = {};
    byCategory.forEach(c => {
      categoryMap[c.category] = c._count.category;
    });

    return res.json({
      success: true,
      stats: {
        total,
        pending: statusMap.PENDING,
        passed: statusMap.PASSED,
        failed: statusMap.FAILED,
        skipped: statusMap.SKIPPED,
        byCritical: priorityMap.CRITICAL,
        byHigh: priorityMap.HIGH,
        byMedium: priorityMap.MEDIUM,
        byLow: priorityMap.LOW,
        byCategory: categoryMap,
      },
    });
  } catch (error) {
    console.error('[TestCases] Stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * PATCH /test-cases/:id
 * Update a single test case (status/notes)
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = updateStatusSchema.parse(req.body);

    const testCase = await prisma.testCase.update({
      where: { id },
      data: {
        status: data.status as TestStatus,
        notes: data.notes,
      },
    });

    return res.json({
      success: true,
      testCase: {
        ...testCase,
        createdAt: testCase.createdAt.toISOString(),
        updatedAt: testCase.updatedAt.toISOString(),
        syncedAt: testCase.syncedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[TestCases] Update error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * DELETE /sessions/:sessionId/test-cases
 * Delete all test cases for a session
 */
router.delete('/:sessionId/test-cases', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const deleted = await prisma.testCase.deleteMany({
      where: { sessionId },
    });

    return res.json({
      success: true,
      count: deleted.count,
      message: `${deleted.count} test cases deleted`,
    });
  } catch (error) {
    console.error('[TestCases] Delete error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

