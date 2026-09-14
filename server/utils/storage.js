import User from '../models/User.js';

/**
 * Increment storage used and return the updated user document.
 */
export const incrementStorageUsed = async (userId, bytes) => {
    return User.findByIdAndUpdate(
        userId,
        { $inc: { storageUsed: bytes } },
        { new: true }
    ).select('storageUsed storageQuota');
};

/**
 * Return storage fields for API responses.
 */
export const storagePayload = (user) => ({
    storageUsed: user?.storageUsed ?? 0,
    storageQuota: user?.storageQuota ?? 0,
});
