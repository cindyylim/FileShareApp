import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CHUNK_SIZE,
    chunkFile,
    formatFileSize,
    getFileIcon,
    getFileExtension,
    formatDate,
} from './fileUtils.js';

describe('fileUtils', () => {
    describe('CHUNK_SIZE', () => {
        it('is 5MB', () => {
            expect(CHUNK_SIZE).toBe(5 * 1024 * 1024);
        });
    });

    describe('chunkFile', () => {
        it('returns a single chunk for small files', () => {
            const file = { size: 1024, slice: (start, end) => ({ start, end }) };
            const chunks = chunkFile(file);
            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({ start: 0, end: 1024 });
        });

        it('splits large files into multiple chunks', () => {
            const size = CHUNK_SIZE * 2 + 1000;
            const file = {
                size,
                slice: (start, end) => ({ start, end }),
            };
            const chunks = chunkFile(file);
            expect(chunks).toHaveLength(3);
            expect(chunks[0]).toEqual({ start: 0, end: CHUNK_SIZE });
            expect(chunks[1]).toEqual({ start: CHUNK_SIZE, end: CHUNK_SIZE * 2 });
            expect(chunks[2]).toEqual({ start: CHUNK_SIZE * 2, end: size });
        });
    });

    describe('formatFileSize', () => {
        it('formats bytes', () => {
            expect(formatFileSize(0)).toBe('0 Bytes');
            expect(formatFileSize(500)).toBe('500 Bytes');
        });

        it('formats kilobytes and megabytes', () => {
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(1536)).toBe('1.5 KB');
            expect(formatFileSize(1048576)).toBe('1 MB');
        });

        it('handles invalid input', () => {
            expect(formatFileSize(null)).toBe('0 Bytes');
            expect(formatFileSize(undefined)).toBe('0 Bytes');
            expect(formatFileSize(NaN)).toBe('0 Bytes');
        });
    });

    describe('getFileIcon', () => {
        it('returns correct icons for MIME types', () => {
            expect(getFileIcon('image/png')).toBe('🖼️');
            expect(getFileIcon('video/mp4')).toBe('🎥');
            expect(getFileIcon('audio/mpeg')).toBe('🎵');
            expect(getFileIcon('application/pdf')).toBe('📕');
            expect(getFileIcon('application/zip')).toBe('🗜️');
            expect(getFileIcon('text/plain')).toBe('📄');
        });

        it('returns default icon for unknown types', () => {
            expect(getFileIcon(null)).toBe('📄');
            expect(getFileIcon('application/octet-stream')).toBe('📎');
        });
    });

    describe('getFileExtension', () => {
        it('extracts uppercase extension', () => {
            expect(getFileExtension('document.pdf')).toBe('PDF');
            expect(getFileExtension('archive.tar.gz')).toBe('GZ');
        });

        it('returns empty string when no extension', () => {
            expect(getFileExtension('README')).toBe('');
        });
    });

    describe('formatDate', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-08-19T12:00:00Z'));
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns relative times for recent dates', () => {
            const thirtySecsAgo = new Date('2026-08-19T11:59:30Z').toISOString();
            expect(formatDate(thirtySecsAgo)).toBe('Just now');

            const fiveMinsAgo = new Date('2026-08-19T11:55:00Z').toISOString();
            expect(formatDate(fiveMinsAgo)).toBe('5m ago');

            const threeHoursAgo = new Date('2026-08-19T09:00:00Z').toISOString();
            expect(formatDate(threeHoursAgo)).toBe('3h ago');

            const twoDaysAgo = new Date('2026-08-17T12:00:00Z').toISOString();
            expect(formatDate(twoDaysAgo)).toBe('2d ago');
        });

        it('returns locale date string for older dates', () => {
            const twoWeeksAgo = new Date('2026-08-01T12:00:00Z').toISOString();
            const result = formatDate(twoWeeksAgo);
            expect(result).not.toMatch(/ago/);
        });
    });
});
