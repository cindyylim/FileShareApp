import { describe, it, expect } from 'vitest';
import { sanitizeFilename, contentDispositionFilename } from '../../utils/sanitize.js';

describe('sanitize utilities', () => {
    describe('sanitizeFilename', () => {
        it('strips path segments', () => {
            expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
            expect(sanitizeFilename('folder/file.txt')).toBe('file.txt');
        });

        it('rejects invalid names', () => {
            expect(() => sanitizeFilename('..')).toThrow('Invalid filename');
            expect(() => sanitizeFilename('')).toThrow('Invalid filename');
        });
    });

    describe('contentDispositionFilename', () => {
        it('returns a safe attachment header', () => {
            const header = contentDispositionFilename('my file.pdf');
            expect(header).toContain('attachment');
            expect(header).toContain('my file.pdf');
        });
    });
});
