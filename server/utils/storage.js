import User from '../models/User.js';

const storageSelect = 'storageUsed storageQuota pendingStorage';

/**
 * Increment storage used and return the updated user document.
 */
export const incrementStorageUsed = async (userId, bytes, session) => {
    return User.findByIdAndUpdate(
        userId,
        { $inc: { storageUsed: bytes } },
        { new: true, session }
    ).select(storageSelect);
};

/**
 * Atomically reserve storage for an in-progress upload.
 * Returns null when the quota would be exceeded.
 */
export const reserveStorage = async (userId, bytes, session) => {
    if (bytes <= 0) {
        return null;
    }

    return User.findOneAndUpdate(
        {
            _id: userId,
            $expr: {
                $lte: [
                    { $add: ['$storageUsed', '$pendingStorage', bytes] },
                    '$storageQuota',
                ],
            },
        },
        { $inc: { pendingStorage: bytes } },
        { new: true, session }
    ).select(storageSelect);
};

/**
 * Release a pending storage reservation (e.g. on abort).
 */
export const releaseStorageReservation = async (userId, bytes, session) => {
    return User.findByIdAndUpdate(
        userId,
        { $inc: { pendingStorage: -bytes } },
        { new: true, session }
    ).select(storageSelect);
};

/**
 * Move bytes from pending reservation into committed storage usage.
 */
export const finalizeStorageReservation = async (userId, bytes, session) => {
    return User.findByIdAndUpdate(
        userId,
        { $inc: { storageUsed: bytes, pendingStorage: -bytes } },
        { new: true, session }
    ).select(storageSelect);
};

/**
 * Return storage fields for API responses.
 */
export const storagePayload = (user) => ({
    storageUsed: user?.storageUsed ?? 0,
    storageQuota: user?.storageQuota ?? 0,
});
