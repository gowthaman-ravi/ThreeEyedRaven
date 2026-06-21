import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// ============================================
// Validation Schemas
// ============================================

const validateLicenseSchema = z.object({
  licenseKey: z.string().min(1),
  deviceId: z.string().optional(),
});

const activateLicenseSchema = z.object({
  licenseKey: z.string().min(1),
  email: z.string().email(),
  deviceId: z.string().optional(),
});

// ============================================
// Routes
// ============================================

/**
 * POST /auth/validate-license
 * Validate a license key and return tier information
 */
router.post('/validate-license', async (req: Request, res: Response) => {
  try {
    const { licenseKey } = validateLicenseSchema.parse(req.body);

    // Find user with this license key
    const user = await prisma.user.findUnique({
      where: { licenseKey },
      include: { organization: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        valid: false,
        message: 'Invalid license key',
      });
    }

    if (user.licenseStatus !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        valid: false,
        message: `License is ${user.licenseStatus.toLowerCase()}`,
        status: user.licenseStatus,
      });
    }

    return res.json({
      success: true,
      valid: true,
      tier: user.organization?.tier || 'PRO',
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      organizationName: user.organization?.name,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Auth] Validate license error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /auth/activate
 * Activate a license for a new device/user
 */
router.post('/activate', async (req: Request, res: Response) => {
  try {
    const { licenseKey, email } = activateLicenseSchema.parse(req.body);

    // Check if license key exists and is not already assigned
    let user = await prisma.user.findUnique({
      where: { licenseKey },
    });

    if (user) {
      // License already exists - check if it's the same email
      if (user.email !== email) {
        return res.status(403).json({
          success: false,
          error: 'License key is already assigned to another user',
        });
      }
      // Same email, just return success
      return res.json({
        success: true,
        message: 'License already activated',
        tier: 'PRO', // Would come from organization in real implementation
      });
    }

    // Check if user with this email exists
    user = await prisma.user.findUnique({
      where: { email },
    });

    if (user) {
      // Update existing user with license key
      await prisma.user.update({
        where: { email },
        data: {
          licenseKey,
          licenseStatus: 'ACTIVE',
        },
      });
    } else {
      // Create new user with license
      await prisma.user.create({
        data: {
          id: uuidv4(),
          email,
          licenseKey,
          licenseStatus: 'ACTIVE',
        },
      });
    }

    return res.json({
      success: true,
      message: 'License activated successfully',
      tier: 'PRO',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Auth] Activate error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /auth/deactivate
 * Deactivate a license (for device switching)
 */
router.post('/deactivate', async (req: Request, res: Response) => {
  try {
    const { licenseKey } = validateLicenseSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { licenseKey },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'License not found',
      });
    }

    await prisma.user.update({
      where: { licenseKey },
      data: {
        licenseStatus: 'INACTIVE',
      },
    });

    return res.json({
      success: true,
      message: 'License deactivated successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    console.error('[Auth] Deactivate error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * POST /auth/generate-api-key
 * Generate an API key for an organization (admin use)
 */
router.post('/generate-api-key', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.body;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID required',
      });
    }

    const apiKey = `dashing_${uuidv4().replace(/-/g, '')}`;

    await prisma.organization.update({
      where: { id: organizationId },
      data: { apiKey },
    });

    return res.json({
      success: true,
      apiKey,
      message: 'API key generated. Store this securely - it cannot be retrieved again.',
    });
  } catch (error) {
    console.error('[Auth] Generate API key error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;

