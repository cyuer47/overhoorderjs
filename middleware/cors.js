import { config } from '../config/index.js';

export const corsMiddleware = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.cors.origin);
  res.setHeader('Access-Control-Allow-Headers', config.cors.headers);
  res.setHeader('Access-Control-Allow-Methods', config.cors.methods);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};
