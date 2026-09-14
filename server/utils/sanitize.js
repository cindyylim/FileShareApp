/**
 * Sanitize a user-provided filename for safe storage keys.
 */
export const sanitizeFilename = (filename) => {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Invalid filename');
    }

    const basename = filename.replace(/\\/g, '/').split('/').pop();
    const safe = basename.replace(/[^\w.\- ()]/g, '_').slice(0, 255);

    if (!safe || safe === '.' || safe === '..') {
        throw new Error('Invalid filename');
    }

    return safe;
};

/**
 * Build a safe Content-Disposition attachment header value.
 */
export const contentDispositionFilename = (filename) => {
    const safe = sanitizeFilename(filename);
    const encoded = encodeURIComponent(safe);
    return `attachment; filename="${safe.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`;
};
