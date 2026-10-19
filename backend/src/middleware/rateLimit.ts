import rateLimit from 'express-rate-limit';

const windowMs = process.env.RATE_LIMIT_WINDOW_MS ? parseInt(process.env.RATE_LIMIT_WINDOW_MS) : 15 * 60 * 1000;
const generalLimit = process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX) : 100;
const authLimit = process.env.AUTH_RATE_LIMIT_MAX ? parseInt(process.env.AUTH_RATE_LIMIT_MAX) : 10;
const aiLimit = process.env.AI_RATE_LIMIT_MAX ? parseInt(process.env.AI_RATE_LIMIT_MAX) : 20;
const publicLimit = process.env.PUBLIC_RATE_LIMIT_MAX ? parseInt(process.env.PUBLIC_RATE_LIMIT_MAX) : 50;

export const generalLimiter = rateLimit({
  windowMs,
  max: generalLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});

export const authLimiter = rateLimit({
  windowMs,
  max: authLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' }
});

export const aiLimiter = rateLimit({
  windowMs,
  max: aiLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many AI requests, please try again later.' }
});

export const publicLimiter = rateLimit({
  windowMs,
  max: publicLimit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many public requests, please try again later.' }
});
