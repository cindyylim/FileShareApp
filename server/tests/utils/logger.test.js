import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../utils/logger.js';

describe('logger utilities', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-16T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const parseLastCall = (spy) => JSON.parse(spy.mock.calls[0][0]);

    it('logs info messages as JSON', () => {
        logger.info('Server started');

        expect(console.log).toHaveBeenCalledOnce();
        expect(parseLastCall(console.log)).toEqual({
            level: 'info',
            message: 'Server started',
            timestamp: '2026-09-16T12:00:00.000Z',
        });
    });

    it('logs warn messages as JSON', () => {
        logger.warn('Storage quota high');

        expect(console.warn).toHaveBeenCalledOnce();
        expect(parseLastCall(console.warn)).toEqual({
            level: 'warn',
            message: 'Storage quota high',
            timestamp: '2026-09-16T12:00:00.000Z',
        });
    });

    it('logs error messages as JSON', () => {
        logger.error('Upload failed');

        expect(console.error).toHaveBeenCalledOnce();
        expect(parseLastCall(console.error)).toEqual({
            level: 'error',
            message: 'Upload failed',
            timestamp: '2026-09-16T12:00:00.000Z',
        });
    });

    it('includes optional metadata in the log entry', () => {
        logger.info('File uploaded', { fileId: 'abc123', size: 1024 });

        expect(parseLastCall(console.log)).toEqual({
            level: 'info',
            message: 'File uploaded',
            timestamp: '2026-09-16T12:00:00.000Z',
            meta: { fileId: 'abc123', size: 1024 },
        });
    });

    it('omits meta when not provided', () => {
        logger.error('Something went wrong');

        const entry = parseLastCall(console.error);
        expect(entry).not.toHaveProperty('meta');
    });
});
