import dotenv from "dotenv";

dotenv.config();

// Validate that SECRET is set in environment
if (!process.env.SECRET) {
  throw new Error(
    "FATAL: SECRET environment variable is not set. Please set it in .env file.",
  );
}

export const config = {
  // Server
  PORT: parseInt(process.env.PORT || "3000", 10),
  SECRET: process.env.SECRET,
  NODE_ENV: process.env.NODE_ENV || "development",

  // Logging
  DEBUG_REQUESTS:
    process.env.DEBUG_REQUESTS === "1" || process.env.DEBUG === "true",

  // Security
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:3000",
  UPDATE_SECRET: process.env.UPDATE_SECRET || null,

  // Database
  DATABASE_PATH: process.env.DATABASE_PATH || "./data.db",
};

// Log configuration on startup (without exposing secrets)
export function logConfig() {
  console.log("Configuration loaded:");
  console.log(`  Environment: ${config.NODE_ENV}`);
  console.log(`  Port: ${config.PORT}`);
  console.log(`  CORS Origin: ${config.CORS_ORIGIN}`);
  console.log(`  Debug Requests: ${config.DEBUG_REQUESTS}`);
}
