import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Middleware to verify JWT token and attach user to request
 */
export const authenticateToken = async (req, res, next) => {
    try {
        // Get token from cookie or Authorization header
        let token = req.cookies.token;

        if (!token) {
            const authHeader = req.headers.authorization;
            token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        }

        if (!token) {
            return res.status(401).json({
                error: 'Access denied. No token provided.'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get user from database
        const user = await User.findById(decoded.userId).select('-password');

        if (!user) {
            return res.status(401).json({
                error: 'Invalid token. User not found.'
            });
        }

        // Attach user to request
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired.' });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Server error during authentication.' });
    }
};

/**
 * Generate JWT token for user
 */
export const generateToken = (userId) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET is not configured');
    }

    return jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
};
