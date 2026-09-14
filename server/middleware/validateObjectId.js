import mongoose from 'mongoose';

/**
 * Return 400 for invalid MongoDB ObjectId route params.
 */
export const validateObjectId = (paramName = 'id') => (req, res, next) => {
    const value = req.params[paramName];

    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        return res.status(400).json({ error: `Invalid ${paramName}` });
    }

    next();
};
