import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        trim: true,
        minlength: [3, 'Username must be at least 3 characters'],
        maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
    },
    storageUsed: {
        type: Number,
        default: 0, // in bytes
    },
    pendingStorage: {
        type: Number,
        default: 0, // bytes reserved by in-progress uploads
    },
    storageQuota: {
        type: Number,
        default: 5 * 1024 * 1024 * 1024, // 5GB default quota
    },
    sharedFiles: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'File',
    }],
}, {
    timestamps: true, // adds createdAt and updatedAt
});

/**
 * Hash password before saving
 */
userSchema.pre('save', async function (next) {
    // Only hash if password is modified
    if (!this.isModified('password')) {
        return next();
    }

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

/**
 * Compare password for login
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if user has enough storage
 */
userSchema.methods.hasStorageSpace = function (fileSize) {
    return (this.storageUsed + fileSize) <= this.storageQuota;
};


const User = mongoose.model('User', userSchema);

export default User;
