import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  secret: process.env.SECRET || 'supersecretkey', // TODO: Remove default in production
  nodeEnv: process.env.NODE_ENV || 'development',
  debugRequests: process.env.DEBUG_REQUESTS === 'true',
  databasePath: process.env.DATABASE_PATH || './data.db',
  baseUrl: process.env.BASE_URL || `http://localhost:3000`,
  
  // Email configuration
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || `Overhoorder <no-reply@${process.env.EMAIL_DOMAIN || 'example.com'}>`,
    domain: process.env.EMAIL_DOMAIN || 'example.com',
    allowSelfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === '1'
  },
  
  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    headers: 'Authorization,Content-Type',
    methods: 'GET,POST,PUT,DELETE,OPTIONS'
  }
};
