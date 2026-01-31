import { config } from "../config/index.js";

/**
 * CORS middleware - properly configured for security
 */
export function corsMiddleware(req, res, next) {
  const allowedOrigins = config.CORS_ORIGIN.split(",").map((o) => o.trim());
  const origin = req.headers.origin;

  // Check if origin is allowed
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || allowedOrigins[0]);
  }

  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
}

/**
 * Request logger middleware
 */
export function requestLoggerMiddleware(req, res, next) {
  if (config.DEBUG_REQUESTS) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
}

/**
 * Error handler middleware
 */
export function errorHandlerMiddleware(err, req, res, next) {
  console.error("Error:", err);

  const statusCode = err.status || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    error: message,
    ...(config.NODE_ENV === "development" && { details: err.stack }),
  });
}
