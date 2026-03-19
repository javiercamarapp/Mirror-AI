import Redis from 'ioredis';
import { logger } from './logger.js';

let redisClient: Redis | null = null;
let redisAvailable = false;

/**
 * Initialize and return the Redis client.
 * Gracefully falls back to unavailable state if Redis cannot be reached.
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisAvailable ? redisClient : null;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logger.warn('REDIS_URL not set — Redis features disabled, falling back to in-memory');
    return null;
  }

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        logger.error({ attempt: times }, 'Redis retry limit exceeded, giving up');
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 5000,
  });

  redisClient.on('connect', () => {
    redisAvailable = true;
    logger.info('Redis connected');
  });

  redisClient.on('ready', () => {
    redisAvailable = true;
    logger.info('Redis ready');
  });

  redisClient.on('error', (err) => {
    redisAvailable = false;
    logger.error({ err }, 'Redis connection error');
  });

  redisClient.on('close', () => {
    redisAvailable = false;
    logger.warn('Redis connection closed');
  });

  return redisAvailable ? redisClient : null;
}

/**
 * Check whether Redis is currently connected and responsive.
 */
export async function isRedisHealthy(): Promise<boolean> {
  if (!redisClient || !redisAvailable) return false;
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Gracefully disconnect Redis.
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    redisAvailable = false;
    logger.info('Redis disconnected gracefully');
  }
}
