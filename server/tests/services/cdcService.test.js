import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CDCService } from '../../services/cdcService.js';

const createMockIo = () => {
    const emitFn = vi.fn();
    return {
        to: vi.fn(() => ({ emit: emitFn })),
        _emitFn: emitFn,
    };
};

describe('CDCService', () => {
    let cdcService;
    let mockIo;

    beforeEach(() => {
        mockIo = createMockIo();
        cdcService = new CDCService(mockIo);
    });

    describe('registerUserSocket / unregisterUserSocket', () => {
        it('tracks multiple sockets per user', () => {
            cdcService.registerUserSocket('user1', 'socket-a');
            cdcService.registerUserSocket('user1', 'socket-b');

            expect(cdcService.userSockets.get('user1').size).toBe(2);

            cdcService.unregisterUserSocket('user1', 'socket-a');
            expect(cdcService.userSockets.get('user1').size).toBe(1);

            cdcService.unregisterUserSocket('user1', 'socket-b');
            expect(cdcService.userSockets.has('user1')).toBe(false);
        });
    });

    describe('broadcastToUser', () => {
        it('emits file:change to all user sockets', () => {
            cdcService.registerUserSocket('user1', 'socket-1');
            cdcService.registerUserSocket('user1', 'socket-2');

            const payload = { type: 'insert', file: { _id: 'file1' } };
            cdcService.broadcastToUser('user1', payload);

            expect(mockIo.to).toHaveBeenCalledTimes(2);
            expect(mockIo.to).toHaveBeenCalledWith('socket-1');
            expect(mockIo.to).toHaveBeenCalledWith('socket-2');
            expect(mockIo._emitFn).toHaveBeenCalledWith('file:change', payload);
        });

        it('does nothing when user has no connected sockets', () => {
            cdcService.broadcastToUser('offline-user', { type: 'delete' });
            expect(mockIo.to).not.toHaveBeenCalled();
        });
    });

    describe('sanitizeFile', () => {
        it('strips sensitive fields and returns safe metadata', () => {
            const file = {
                _id: 'file123',
                filename: 'doc.pdf',
                originalName: 'doc.pdf',
                size: 1024,
                mimeType: 'application/pdf',
                path: '/',
                uploadStatus: 'completed',
                isDeleted: false,
                createdAt: new Date(),
                updatedAt: new Date(),
                s3Key: 'secret/key',
                chunks: [{ partNumber: 1 }],
            };

            const sanitized = cdcService.sanitizeFile(file);

            expect(sanitized).toEqual({
                _id: 'file123',
                filename: 'doc.pdf',
                originalName: 'doc.pdf',
                size: 1024,
                mimeType: 'application/pdf',
                path: '/',
                uploadStatus: 'completed',
                isDeleted: false,
                createdAt: file.createdAt,
                updatedAt: file.updatedAt,
            });
            expect(sanitized.s3Key).toBeUndefined();
            expect(sanitized.chunks).toBeUndefined();
        });

        it('returns null for null input', () => {
            expect(cdcService.sanitizeFile(null)).toBeNull();
        });
    });

    describe('handleChange', () => {
        it('broadcasts insert events to owner and shared users', async () => {
            const broadcastSpy = vi.spyOn(cdcService, 'broadcastToUser');

            const ownerId = '507f1f77bcf86cd799439011';
            const sharedId = '507f1f77bcf86cd799439012';

            await cdcService.handleChange({
                operationType: 'insert',
                documentKey: { _id: 'file456' },
                fullDocument: {
                    _id: 'file456',
                    filename: 'new.txt',
                    originalName: 'new.txt',
                    size: 100,
                    mimeType: 'text/plain',
                    owner: ownerId,
                    sharedWith: [sharedId],
                    uploadStatus: 'completed',
                    isDeleted: false,
                    path: '/',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            expect(broadcastSpy).toHaveBeenCalledTimes(2);
            expect(broadcastSpy).toHaveBeenCalledWith(
                ownerId,
                expect.objectContaining({ type: 'insert' })
            );
            expect(broadcastSpy).toHaveBeenCalledWith(
                sharedId,
                expect.objectContaining({ type: 'insert' })
            );
        });

        it('uses cached metadata for delete events', async () => {
            const broadcastSpy = vi.spyOn(cdcService, 'broadcastToUser');
            const ownerId = '507f1f77bcf86cd799439013';

            cdcService.fileMetadataCache.set('file789', {
                owner: ownerId,
                sharedWith: [],
            });

            await cdcService.handleChange({
                operationType: 'delete',
                documentKey: { _id: 'file789' },
                fullDocument: null,
            });

            expect(broadcastSpy).toHaveBeenCalledWith(
                ownerId,
                expect.objectContaining({
                    type: 'delete',
                    file: { _id: 'file789' },
                })
            );
            expect(cdcService.fileMetadataCache.has('file789')).toBe(false);
        });
    });
});
