import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map();
const mockSocket = {
    id: 'test-socket',
    connected: true,
    disconnected: false,
    on: vi.fn((event, cb) => handlers.set(event, cb)),
    off: vi.fn((event) => handlers.delete(event)),
    connect: vi.fn(),
    disconnect: vi.fn(() => { mockSocket.disconnected = true; }),
};

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => mockSocket),
}));

import { initSocket, onFileChange, offFileChange, disconnectSocket } from './syncService';

describe('syncService', () => {
    beforeEach(() => {
        disconnectSocket();
        handlers.clear();
        vi.clearAllMocks();
        mockSocket.disconnected = false;
    });

    it('initializes socket connection', () => {
        const socket = initSocket();
        expect(socket).toBeDefined();
        expect(socket.id).toBe('test-socket');
    });

    it('registers and removes file change handlers', () => {
        initSocket();
        const handler = vi.fn();
        onFileChange(handler);

        const dispatch = handlers.get('file:change');
        dispatch({ type: 'insert', file: { _id: '1' } });
        expect(handler).toHaveBeenCalledWith({ type: 'insert', file: { _id: '1' } });

        offFileChange(handler);
        dispatch({ type: 'delete', file: { _id: '2' } });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
