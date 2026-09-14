const requests = new Map();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 100;

/**
 * Simple in-memory rate limiter for auth endpoints.
 */
export const authRateLimit = (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = requests.get(key) || { count: 0, resetAt: now + WINDOW_MS };

    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + WINDOW_MS;
    }

    entry.count += 1;
    requests.set(key, entry);

    if (entry.count > MAX_REQUESTS) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    next();
};
