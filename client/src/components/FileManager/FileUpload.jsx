import React, { useState, useRef } from 'react';
import useAuthStore from '../../stores/authStore';
import { fileAPI, uploadChunk } from '../../services/api';
import { chunkFile, calculateFileHash, calculateChunkHash, formatFileSize } from '../../utils/fileUtils';
import pako from 'pako';
import './FileUpload.css';

function FileUpload({ onUploadComplete, onError }) {
    const { user, setUser } = useAuthStore();
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);
    const activeUploadRef = useRef(null);
    const abortRef = useRef(false);
    const uploadInProgressRef = useRef(false);
    const completingRef = useRef(false);

    const handleFileSelect = (file) => {
        setSelectedFile(file);
        setError('');
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const files = e.dataTransfer.files;
        if (files && files[0]) {
            handleFileSelect(files[0]);
        }
    };

    const handleInputChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
        }
    };

    // Check if file should be compressed (text-based files)
    const shouldCompressFile = (file) => {
        const textTypes = [
            'text/',
            'application/json',
            'application/javascript',
            'application/xml',
            'application/x-javascript',
            'application/typescript',
        ];
        return textTypes.some(type => file.type.startsWith(type) || file.type === type);
    };

    // Compress file using gzip
    const compressFile = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const compressed = pako.gzip(new Uint8Array(arrayBuffer));
        return new Blob([compressed], { type: file.type });
    };

    const uploadFile = async () => {
        if (!selectedFile || uploadInProgressRef.current) return;

        uploadInProgressRef.current = true;
        setUploading(true);
        setProgress(0);
        setError('');
        abortRef.current = false;

        try {
            // Step 1: Check if file should be compressed
            const shouldCompress = shouldCompressFile(selectedFile);
            let fileToUpload = selectedFile;
            const originalSize = selectedFile.size;

            // Step 2: Compress file if it's a text file
            if (shouldCompress) {
                fileToUpload = await compressFile(selectedFile);
                console.log(`Compressed ${selectedFile.name}: ${formatFileSize(originalSize)} -> ${formatFileSize(fileToUpload.size)}`);
            }

            // Step 3: Calculate file hash
            const hash = await calculateFileHash(fileToUpload);

            // Step 4: Initialize upload
            const initResponse = await fileAPI.initUpload({
                filename: selectedFile.name,
                size: fileToUpload.size,
                mimeType: selectedFile.type,
                isCompressed: shouldCompress,
                originalSize: shouldCompress ? originalSize : undefined,
            });

            const { fileId, uploadId, useLocalStorage } = initResponse.data;
            activeUploadRef.current = fileId;

            // Step 5: Chunk the file (compressed or original)
            const chunks = chunkFile(fileToUpload);

            // Step 6: Calculate fingerprints for all chunks
            console.log('Calculating chunk fingerprints...');
            const chunkFingerprints = [];
            for (let i = 0; i < chunks.length; i++) {
                const fingerprint = await calculateChunkHash(chunks[i]);
                chunkFingerprints.push({
                    partNumber: i + 1,
                    fingerprint,
                });
            }

            // Step 7: Check upload status to see which chunks are already uploaded
            let uploadedChunks = [];
            try {
                const statusResponse = await fileAPI.getUploadStatus(fileId);
                uploadedChunks = statusResponse.data.uploadedChunks || [];
            } catch (error) {
                // If upload status check fails, assume nothing is uploaded
                console.log('No previous upload found, starting fresh');
            }

            // Step 8: Determine which chunks need to be uploaded
            const chunksToUpload = chunkFingerprints.filter(({ partNumber, fingerprint }) => {
                const alreadyUploaded = uploadedChunks.find(
                    chunk => chunk.partNumber === partNumber && chunk.fingerprint === fingerprint
                );
                return !alreadyUploaded;
            });

            console.log(`Total chunks: ${chunks.length}, Already uploaded: ${uploadedChunks.length}, To upload: ${chunksToUpload.length}`);


            const parts = [];
            let completedChunks = 0;

            // Step 9: Upload chunks in parallel (with concurrency limit)
            const MAX_CONCURRENT_UPLOADS = 5;
            const uploadPromises = [];

            for (let i = 0; i < chunksToUpload.length; i += MAX_CONCURRENT_UPLOADS) {
                const batch = chunksToUpload.slice(i, i + MAX_CONCURRENT_UPLOADS);

                const batchPromises = batch.map(async ({ partNumber, fingerprint }) => {
                    if (abortRef.current) throw new Error('Upload cancelled');

                    const chunk = chunks[partNumber - 1];

                    // Get pre-signed URL
                    const urlResponse = await fileAPI.getPresignedUrl({
                        fileId,
                        uploadId,
                        partNumber,
                    });

                    const { presignedUrl } = urlResponse.data;

                    const etag = await uploadChunk(presignedUrl, chunk, fingerprint, useLocalStorage);

                    if (!useLocalStorage) {
                        await fileAPI.recordChunk({
                            fileId,
                            uploadId,
                            partNumber,
                            etag,
                            size: chunk.size,
                            fingerprint,
                        });
                    }

                    // Update progress
                    completedChunks++;
                    const currentProgress = Math.round(((uploadedChunks.length + completedChunks) / chunks.length) * 100);
                    setProgress(currentProgress);

                    // Return part info with fingerprint
                    return {
                        partNumber,
                        etag,
                        size: chunk.size,
                        fingerprint,
                    };
                });

                // Wait for this batch to complete before starting next batch
                const batchResults = await Promise.all(batchPromises);
                parts.push(...batchResults);
            }

            // Step 10: Add already uploaded chunks to parts array
            uploadedChunks.forEach(chunk => {
                parts.push(chunk);
            });

            // Sort parts by partNumber
            parts.sort((a, b) => a.partNumber - b.partNumber);

            // Step 11: Complete upload (guard against duplicate complete calls)
            if (completingRef.current) return;
            completingRef.current = true;

            const completeResponse = await fileAPI.completeUpload({
                fileId,
                uploadId,
                parts,
                hash,
            });

            if (completeResponse.data.user && user) {
                setUser({ ...user, ...completeResponse.data.user });
            }

            setProgress(100);
            setSelectedFile(null);
            activeUploadRef.current = null;
            onUploadComplete?.(completeResponse.data.user);

            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }

        } catch (err) {
            if (abortRef.current) {
                setError('Upload cancelled');
                onError?.('Upload cancelled');
            } else {
                const msg = err.response?.data?.error || err.message || 'Upload failed. Please try again.';
                setError(msg);
                onError?.(msg);
            }
            console.error('Upload error:', err);
        } finally {
            completingRef.current = false;
            uploadInProgressRef.current = false;
            setUploading(false);
            activeUploadRef.current = null;
        }
    };

    const handleCancelUpload = async () => {
        abortRef.current = true;
        if (activeUploadRef.current) {
            try {
                await fileAPI.abortUpload(activeUploadRef.current);
            } catch {
                // ignore abort errors
            }
        }
        setUploading(false);
        setSelectedFile(null);
        setProgress(0);
        activeUploadRef.current = null;
    };

    return (
        <div className="file-upload glass-card">
            <div
                className={`upload-dropzone ${dragActive ? 'active' : ''} ${uploading ? 'uploading' : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => !uploading && fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleInputChange}
                    style={{ display: 'none' }}
                    disabled={uploading}
                />

                <div className="upload-icon">
                    {uploading ? '⏳' : '☁️'}
                </div>

                <div className="upload-text">
                    {selectedFile ? (
                        <>
                            <p><strong>{selectedFile.name}</strong></p>
                            <p className="upload-text-secondary">{formatFileSize(selectedFile.size)}</p>
                        </>
                    ) : (
                        <>
                            <p><strong>Drop files here or click to browse</strong></p>
                            <p className="upload-text-secondary">Support for all file types</p>
                        </>
                    )}
                </div>

                {uploading && (
                    <div className="upload-progress">
                        <div className="progress-bar">
                            <div
                                className="progress-bar-fill"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="progress-text">{progress}%</p>
                    </div>
                )}
            </div>

            {error && (
                <div className="error-message slide-up">
                    {error}
                </div>
            )}

            {(selectedFile || uploading) && (
                <div className="upload-actions">
                    <button
                        className="btn btn-secondary"
                        onClick={() => uploading ? handleCancelUpload() : (setSelectedFile(null), fileInputRef.current && (fileInputRef.current.value = ''))}
                    >
                        {uploading ? 'Cancel Upload' : 'Cancel'}
                    </button>
                    {!uploading && (
                        <button className="btn btn-primary" onClick={uploadFile}>
                            Upload
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export default FileUpload;
