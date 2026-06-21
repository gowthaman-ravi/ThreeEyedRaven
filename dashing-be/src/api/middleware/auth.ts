import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extend Express Request to include organization info
declare global {
  namespace Express {
    interface Request {
      organization?: {
        id: string;
        name: string;
        tier: string;
      };
      user?: {
        id: string;
        email: string;
      };
    }
  }
}

/**
 * API Key Authentication Middleware
 * Validates the X-API-Key header and attaches organization info to the request
 */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'API key is required. Include X-API-Key header.',
      });
      return;
    }

    // Look up organization by API key
    const organization = await prisma.organization.findUnique({
      where: { apiKey },
    });

    if (!organization) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
      return;
    }

    // Attach organization to request for downstream handlers
    req.organization = {
      id: organization.id,
      name: organization.name,
      tier: organization.tier,
    };

    // Set organization ID header for downstream use
    req.headers['x-organization-id'] = organization.id;

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Authentication failed',
    });
  }
}

/**
 * Optional API Key Authentication
 * Attaches organization info if API key is provided, but doesn't require it
 */
export async function optionalApiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (apiKey) {
      const organization = await prisma.organization.findUnique({
        where: { apiKey },
      });

      if (organization) {
        req.organization = {
          id: organization.id,
          name: organization.name,
          tier: organization.tier,
        };
        req.headers['x-organization-id'] = organization.id;
      }
    }

    next();
  } catch (error) {
    console.error('[Optional Auth Middleware] Error:', error);
    next(); // Continue even on error for optional auth
  }
}

/**
 * Tier Check Middleware Factory
 * Creates middleware that checks if the organization has the required tier
 */
export function requireTier(...allowedTiers: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.organization) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      return;
    }

    if (!allowedTiers.includes(req.organization.tier)) {
      res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: `This feature requires ${allowedTiers.join(' or ')} tier`,
        currentTier: req.organization.tier,
      });
      return;
    }

    next();
  };
}

