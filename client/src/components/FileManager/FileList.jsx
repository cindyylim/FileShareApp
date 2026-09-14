import React, { useState } from 'react';
import useAuthStore from '../../stores/authStore';
import { fileAPI } from '../../services/api';
import { formatFileSize, formatDate, getFileIcon, getFileExtension } from '../../utils/fileUtils';
import pako from 'pako';
import ShareModal from './ShareModal';
import './FileList.css';

function FileList({ files, onFileDeleted, onStorageUpdate, onNotify, showOwner = false, isOwnerView = false }) {
    const { user, setUser } = useAuthStore();
    const [deleting, setDeleting] = useState(null);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [sharingFile, setSharingFile] = useState(null);
    const [actionError, setActionError] = useState('');

    const handleDownload = async (file) => {
        try {
            const response = await fileAPI.download(file._id);
            const { downloadUrl } = response.data;

            const fileResponse = await fetch(downloadUrl, { credentials: 'include' });
            if (!fileResponse.ok) throw new Error('Download failed');

            const blob = await fileResponse.blob();
            let finalBlob = blob;
            if (file.isCompressed) {
                const arrayBuffer = await blob.arrayBuffer();
                const decompressed = pako.ungzip(new Uint8Array(arrayBuffer));
                finalBlob = new Blob([decompressed], { type: file.mimeType });
            }

            const url = window.URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            onNotify?.('Download started', 'success');
        } catch (error) {
            console.error('Download error:', error);
            setActionError('Failed to download file');
            onNotify?.('Failed to download file', 'error');
        }
    };

    const handleDelete = async (file) => {
        if (!confirm(`Are you sure you want to delete "${file.filename}"?`)) return;

        setDeleting(file._id);
        setActionError('');

        try {
            const response = await fileAPI.delete(file._id);
            if (response.data.user && user) {
                setUser({ ...user, ...response.data.user });
                onStorageUpdate?.(response.data.user);
            }
            onFileDeleted?.(file._id);
            onNotify?.('File deleted', 'success');
        } catch (error) {
            console.error('Delete error:', error);
            setActionError('Failed to delete file');
            onNotify?.('Failed to delete file', 'error');
        } finally {
            setDeleting(null);
        }
    };

    const handleShare = (file) => {
        setSharingFile(file);
        setShareModalOpen(true);
    };

    const handleShareSubmit = async (email) => {
        if (!sharingFile) return;
        await fileAPI.share(sharingFile._id, email);
        onNotify?.(`Shared with ${email}`, 'success');
    };

    const handleUnshare = async (file, sharedUserId) => {
        try {
            await fileAPI.unshare(file._id, sharedUserId);
            onNotify?.('Share revoked', 'success');
        } catch (error) {
            onNotify?.(error.response?.data?.error || 'Failed to unshare', 'error');
        }
    };

    const canShareFile = (file) =>
        isOwnerView && user && file.owner && (file.owner._id === user._id || file.owner === user._id);

    if (!files || files.length === 0) {
        return (
            <div className="file-list-empty glass-card">
                <div className="empty-icon">📭</div>
                <p className="empty-text">No files yet</p>
                <p className="empty-subtext">Upload your first file to get started</p>
            </div>
        );
    }

    return (
        <>
            {actionError && <div className="error-message">{actionError}</div>}

            <div className="file-list">
                {files.map((file) => (
                    <div key={file._id} className="file-item glass-card fade-in">
                        <div className="file-icon">
                            {getFileIcon(file.mimeType)}
                            {getFileExtension(file.filename) && (
                                <span className="file-extension">{getFileExtension(file.filename)}</span>
                            )}
                        </div>

                        <div className="file-info">
                            <div className="file-name">{file.filename}</div>
                            <div className="file-meta">
                                <span>{formatFileSize(file.size)}</span>
                                <span>•</span>
                                <span>{formatDate(file.createdAt)}</span>
                                {showOwner && file.owner && (
                                    <>
                                        <span>•</span>
                                        <span>Shared by {file.owner.username || file.owner.email}</span>
                                    </>
                                )}
                                {file.sharedWith?.length > 0 && canShareFile(file) && (
                                    <>
                                        <span>•</span>
                                        <span>{file.sharedWith.length} shared</span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="file-actions">
                            <button className="btn-icon" onClick={() => handleDownload(file)} title="Download">
                                ⬇️
                            </button>
                            {canShareFile(file) && (
                                <button className="btn-icon" onClick={() => handleShare(file)} title="Share">
                                    🤝
                                </button>
                            )}
                            {canShareFile(file) && (
                                <button
                                    className="btn-icon btn-icon-danger"
                                    onClick={() => handleDelete(file)}
                                    disabled={deleting === file._id}
                                    title="Delete"
                                >
                                    {deleting === file._id ? '⏳' : '🗑️'}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <ShareModal
                isOpen={shareModalOpen}
                onClose={() => { setShareModalOpen(false); setSharingFile(null); }}
                onShare={handleShareSubmit}
                fileName={sharingFile?.filename || ''}
            />
        </>
    );
}

export default FileList;
