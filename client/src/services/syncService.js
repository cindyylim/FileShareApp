import { io } from 'socket.io-client';

const SOCKET_URL = '/';

let socket = null;
const fileChangeHandlers = new Set();

/**
 * Initialize socket connection
 */
export const initSocket = () => {
    if (socket) {
        if (socket.disconnected) {
            socket.connect();
        }
        return socket;
    }

    socket = io(SOCKET_URL, {
        withCredentials: true, // Send cookies with handshake
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
        console.log('✅ Socket connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
        console.log('⚠️  Socket disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error.message);
    });

    socket.on('reconnect', (attemptNumber) => {
        console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
    });

    return socket;
};

/**
 * Get current socket instance
 */
export const getSocket = () => {
    return socket;
};

/**
 * Disconnect socket
 */
export const disconnectSocket = () => {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

/**
 * Listen for file changes from CDC
 */
const dispatchFileChange = (data) => {
    fileChangeHandlers.forEach((handler) => handler(data));
};

export const onFileChange = (callback) => {
    if (!socket) {
        console.warn('Socket not initialized');
        return;
    }

    fileChangeHandlers.add(callback);
    socket.off('file:change', dispatchFileChange);
    socket.on('file:change', dispatchFileChange);
};

export const offFileChange = (callback) => {
    if (callback) {
        fileChangeHandlers.delete(callback);
    } else {
        fileChangeHandlers.clear();
    }

    if (socket && fileChangeHandlers.size === 0) {
        socket.off('file:change', dispatchFileChange);
    }
};

export default {
    initSocket,
    getSocket,
    disconnectSocket,
    onFileChange,
    offFileChange,
};
