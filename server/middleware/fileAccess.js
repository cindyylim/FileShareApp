import File from '../models/File.js';

/**
 * Verify the authenticated user can access a file (owner or shared recipient).
 */
export const canAccessFile = async (userId, file) => {
    if (!file || file.isDeleted) return false;
    if (file.owner.toString() === userId.toString()) return true;
    return file.sharedWith.some((id) => id.toString() === userId.toString());
};

/**
 * Load a file and verify download access for the current user.
 */
export const requireFileDownloadAccess = async (req, res, next) => {
    try {
        const file = await File.findById(req.params.id);

        if (!file || file.isDeleted || file.uploadStatus !== 'completed') {
            return res.status(404).json({ error: 'File not found or not ready' });
        }

        if (!(await canAccessFile(req.user._id, file))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        req.fileRecord = file;
        next();
    } catch (error) {
        console.error('File access check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
