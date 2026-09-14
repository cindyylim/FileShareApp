/**
 * Validate required environment variables at startup.
 */
export const validateEnv = () => {
    const errors = [];

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('your-')) {
        errors.push('JWT_SECRET must be set to a secure value');
    }

    if (!process.env.MONGODB_URI) {
        errors.push('MONGODB_URI is required');
    }

    if (errors.length > 0) {
        throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
    }
};
