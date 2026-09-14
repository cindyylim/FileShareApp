import File from '../models/File.js';

/**
 * CDC Service using MongoDB Change Streams
 * Watches for changes in the File collection and broadcasts to Socket.io clients
 */
export class CDCService {
    constructor(io) {
        this.io = io;
        this.changeStream = null;
        this.reconnectTimer = null;
        this.userSockets = new Map(); // Map of userId -> Set of socket IDs
        this.fileMetadataCache = new Map(); // Map of fileId -> { owner, sharedWith }
    }

    /**
     * Start watching for changes in File collection
     */
    async start() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.changeStream) {
            await this.changeStream.close().catch(() => {});
            this.changeStream = null;
        }

        try {
            // Pre-populate fileMetadataCache from database
            const existingFiles = await File.find({}, '_id owner sharedWith');
            existingFiles.forEach((f) => {
                if (f.owner) {
                    this.fileMetadataCache.set(f._id.toString(), {
                        owner: f.owner.toString(),
                        sharedWith: (f.sharedWith || []).map((id) => id.toString()),
                    });
                }
            });
            console.log(`📋 CDC Service: Cached metadata for ${this.fileMetadataCache.size} existing files`);

            // Create change stream watching for insert, update, and delete operations
            this.changeStream = File.watch([
                {
                    $match: {
                        operationType: {
                            $in: ['insert', 'update', 'delete', 'replace']
                        },
                    },
                },
            ], {
                fullDocument: 'updateLookup', // Get full document on updates
            });

            console.log('🔄 CDC Service: Change Stream started');

            // Listen for change events
            this.changeStream.on('change', (change) => {
                this.handleChange(change);
            });

            this.changeStream.on('error', (error) => {
                console.error('❌ CDC Service: Change Stream error:', error);
                if (!this.reconnectTimer) {
                    this.reconnectTimer = setTimeout(() => {
                        this.reconnectTimer = null;
                        this.start();
                    }, 5000);
                }
            });

            this.changeStream.on('close', () => {
                console.log('⚠️  CDC Service: Change Stream closed');
            });

        } catch (error) {
            console.error('❌ CDC Service: Failed to start Change Stream:', error);
            console.error('   Make sure MongoDB is running as a replica set!');
        }
    }

    /**
     * Handle incoming change events
     */
    async handleChange(change) {
        try {
            const { operationType, fullDocument, documentKey } = change;

            console.log(`📡 CDC Event: ${operationType} for file ${documentKey._id}`);

            const fileId = documentKey._id.toString();
            let ownerId;
            let sharedWithIds = [];

            if (fullDocument && fullDocument.owner) {
                ownerId = fullDocument.owner.toString();
                sharedWithIds = (fullDocument.sharedWith || []).map(id => id.toString());

                // Cache file metadata for future delete events
                this.fileMetadataCache.set(fileId, {
                    owner: ownerId,
                    sharedWith: sharedWithIds,
                });
            } else {
                const cached = this.fileMetadataCache.get(fileId);
                if (cached) {
                    ownerId = cached.owner;
                    sharedWithIds = cached.sharedWith;
                    if (operationType === 'delete') {
                        this.fileMetadataCache.delete(fileId);
                    }
                }
            }

            if (!ownerId) {
                console.warn(`⚠️  CDC Service: Cannot determine owner for file ${fileId}`);
                return;
            }

            const payload = {
                type: operationType,
                file: fullDocument
                    ? this.sanitizeFile(fullDocument)
                    : { _id: documentKey._id },
            };

            // Broadcast to all connected devices of the owner and shared users
            const recipients = new Set([ownerId, ...sharedWithIds]);
            recipients.forEach((userId) => {
                this.broadcastToUser(userId, payload);
            });

        } catch (error) {
            console.error('❌ CDC Service: Error handling change:', error);
        }
    }

    /**
     * Broadcast event to all sockets of a specific user
     */
    broadcastToUser(userId, data) {
        const socketIds = this.userSockets.get(userId);

        if (!socketIds || socketIds.size === 0) {
            return; // User not connected
        }

        console.log(`📤 Broadcasting to ${socketIds.size} devices for user ${userId}`);

        socketIds.forEach((socketId) => {
            this.io.to(socketId).emit('file:change', data);
        });
    }

    /**
     * Register a user's socket connection
     */
    registerUserSocket(userId, socketId) {
        if (!this.userSockets.has(userId)) {
            this.userSockets.set(userId, new Set());
        }

        this.userSockets.get(userId).add(socketId);
        console.log(`✅ User ${userId} connected (socket: ${socketId})`);
    }

    /**
     * Unregister a user's socket connection
     */
    unregisterUserSocket(userId, socketId) {
        const sockets = this.userSockets.get(userId);

        if (sockets) {
            sockets.delete(socketId);

            if (sockets.size === 0) {
                this.userSockets.delete(userId);
            }
        }

        console.log(`👋 User ${userId} disconnected (socket: ${socketId})`);
    }

    /**
     * Sanitize file object before sending to client
     */
    sanitizeFile(file) {
        if (!file) return null;

        return {
            _id: file._id,
            filename: file.filename,
            originalName: file.originalName,
            size: file.size,
            mimeType: file.mimeType,
            path: file.path,
            uploadStatus: file.uploadStatus,
            isDeleted: file.isDeleted,
            owner: file.owner,
            sharedWith: file.sharedWith,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
        };
    }

    /**
     * Stop the change stream
     */
    async stop() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.changeStream) {
            await this.changeStream.close();
            this.changeStream = null;
            console.log('⏹️  CDC Service: Change Stream stopped');
        }
    }
}

export default CDCService;
