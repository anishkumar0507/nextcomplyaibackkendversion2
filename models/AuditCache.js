import mongoose from 'mongoose';

/**
 * AuditCache Schema
 * Stores cached audit results indexed by content hash
 * Enables deterministic and fast audit retrieval for identical content
 */
const AuditCacheSchema = new mongoose.Schema({
  // Hash of normalized content + rules version
  // Used as primary lookup key
  auditHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Original (normalized) transcript/extracted text that was audited
  transcript: {
    type: String,
    default: ''
  },

  // The full audit result object returned by Gemini
  auditResult: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },

  // Compliance score from the audit
  score: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },

  // Rules version used for this audit
  // Different rule versions may produce different results
  rulesVersion: {
    type: String,
    default: 'v1',
    index: true
  },

  // When this cached result was created
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // Number of times this cached result was used
  hitCount: {
    type: Number,
    default: 0
  },

  // When this cached result was last retrieved
  lastAccessedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Create indices for efficient querying
AuditCacheSchema.index({ auditHash: 1, rulesVersion: 1 });
AuditCacheSchema.index({ createdAt: -1 });
AuditCacheSchema.index({ lastAccessedAt: -1 });

export default mongoose.model('AuditCache', AuditCacheSchema);
