import express from 'express';
import { config } from './config/index.js';
import { initDB } from './services/database.js';
import { corsMiddleware } from './middleware/cors.js';
import { auth } from './middleware/auth.js';

// Import routes
import adminRoutes from './routes/admin.js';
import licenseRoutes from './routes/license.js';

const app = express();
let routeCount = 0;

// Route tracking
const origGet = app.get;
const origPost = app.post;
const origPut = app.put;
const origDelete = app.delete;

app.get = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] GET ${args[0]}`);
  return origGet.apply(this, args);
};
app.post = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] POST ${args[0]}`);
  return origPost.apply(this, args);
};
app.put = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] PUT ${args[0]}`);
  return origPut.apply(this, args);
};
app.delete = function (...args) {
  routeCount++;
  console.log(`  [ROUTE ${routeCount}] DELETE ${args[0]}`);
  return origDelete.apply(this, args);
};

console.log('✅ Route tracking initialized');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logging
if (config.debugRequests) {
  app.use((req, res, next) => {
    console.log('REQ', req.method, req.path);
    next();
  });
}

// CORS
app.use(corsMiddleware);

// Routes
app.use('/admin', adminRoutes);
app.use('/api/license', licenseRoutes);

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const startServer = async () => {
  try {
    await initDB();
    
    const server = app.listen(config.port, () => {
      console.log(`✅ API running on port ${config.port}`);
      console.log(`🌍 Environment: ${config.nodeEnv}`);
      
      // List routes after startup
      setTimeout(() => {
        console.log('📋 Available routes:');
        if (app._router && Array.isArray(app._router.stack)) {
          const routes = app._router.stack.filter((m) => m.route);
          if (routes.length > 0) {
            routes.forEach((r) => {
              Object.keys(r.route.methods).forEach((method) => {
                console.log(`  ${method.toUpperCase()} ${r.route.path}`);
              });
            });
          }
        }
      }, 1000);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Process terminated');
        process.exit(0);
      });
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack ? err.stack : err);
});

process.on('unhandledRejection', (reason, p) => {
  console.error('unhandledRejection at:', p, 'reason:', reason);
});

startServer();
