import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Import routes
import healthRoutes from './api/routes/health';
import sessionRoutes from './api/routes/sessions';
import actionRoutes from './api/routes/actions';
import errorRoutes from './api/routes/errors';
import authRoutes from './api/routes/auth';
import testCaseRoutes from './api/routes/testCases';

// Import middleware
import { apiKeyAuth } from './api/middleware/auth';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/logger';

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================
// Global Middleware
// ============================================

// Security headers
app.use(helmet());

// CORS configuration - Allow all origins in development
// In production, restrict this to specific origins via ALLOWED_ORIGINS env var
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Organization-Id', 'X-Request-Id'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' })); // Larger limit for batch uploads
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// ============================================
// Routes
// ============================================

// Health check (no auth required)
app.use('/health', healthRoutes);

// Authentication routes
app.use('/auth', authRoutes);

// Protected routes (require API key)
app.use('/sessions', apiKeyAuth, sessionRoutes);
app.use('/sessions', apiKeyAuth, actionRoutes);
app.use('/sessions', apiKeyAuth, errorRoutes);
app.use('/sessions', apiKeyAuth, testCaseRoutes);
app.use('/test-cases', apiKeyAuth, testCaseRoutes); // Direct access to PATCH /test-cases/:id

// ============================================
// Error Handling
// ============================================

app.use(errorHandler);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
  });
});

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Dashing API Server                                    ║
║                                                            ║
║   Environment: ${process.env.NODE_ENV || 'development'}                              ║
║   Port: ${PORT}                                               ║
║   Health: http://localhost:${PORT}/health                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;

