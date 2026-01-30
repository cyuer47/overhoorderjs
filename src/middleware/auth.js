import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

/**
 * Authentication middleware - verifies JWT token
 */
export function authMiddleware(req, res, next) {
  try {
    // Try to get token from Authorization header, body, or query
    const headerToken = req.headers.authorization?.split(" ")[1];
    const bodyToken = req.body?.token || req.query?.token;
    const token = headerToken || bodyToken;

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify token
    req.user = jwt.verify(token, config.SECRET);
    next();
  } catch (err) {
    console.error("Authentication error:", err.message);
    res.status(403).json({ error: "Invalid token" });
  }
}

/**
 * Token generation helper
 */
export function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, config.SECRET);
}

/**
 * Verify JWT token (used for SSE connections)
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.SECRET);
  } catch (err) {
    return null;
  }
}
