import AuditCache from '../models/AuditCache.js';

/**
 * Check if audit result exists in cache
 * Returns cached result if found and updates access metadata
 * @param {string} contentHash - SHA256 hash of normalized content
 * @param {string} rulesVersion - Rules version to match
 * @returns {object|null} Cached audit result or null if not found
 */
export const getCachedAudit = async (contentHash, rulesVersion = 'v1') => {
  try {
    if (!contentHash) {
      console.warn('[Audit Cache] Skipping cache lookup because contentHash is missing');
      return null;
    }

    const cached = await AuditCache.findOne({ 
      $or: [{ contentHash }, { auditHash: contentHash }],
      rulesVersion 
    });

    if (cached) {
      console.log(`[Audit Cache] HIT - Hash: ${contentHash.substring(0, 16)}... | Rules: ${rulesVersion}`);
      
      // Update access metrics for analytics
      await AuditCache.updateOne(
        { _id: cached._id },
        {
          $inc: { hitCount: 1 },
          $set: { lastAccessedAt: new Date() }
        }
      );

      return cached.auditResult;
    }

    console.log(`[Audit Cache] MISS - Hash: ${contentHash.substring(0, 16)}... | Rules: ${rulesVersion}`);
    return null;
  } catch (error) {
    console.error('[Audit Cache] Error retrieving cached audit:', error.message);
    // Fail gracefully - continue without cache on error
    return null;
  }
};

/**
 * Store audit result in cache
 * @param {string} contentHash - SHA256 hash of normalized content
 * @param {string} transcript - Normalized transcript/text that was audited
 * @param {object} auditResult - Full audit result from Gemini
 * @param {number} score - Compliance score
 * @param {string} rulesVersion - Rules version used
 * @returns {object} Stored cache record
 */
export const storeCachedAudit = async (contentHash, transcript, auditResult, score, rulesVersion = 'v1') => {
  try {
    if (!contentHash) {
      console.warn('[Audit Cache] Skipping cache storage because contentHash is missing');
      return null;
    }

    await AuditCache.updateOne(
      { contentHash },
      {
        contentHash,
        auditHash: contentHash,
        transcript,
        auditResult,
        score,
        rulesVersion,
        createdAt: new Date(),
        lastAccessedAt: new Date()
      },
      { upsert: true }
    );

    console.log(`[Audit Cache] Stored - Hash: ${contentHash.substring(0, 16)}... | Score: ${score} | Rules: ${rulesVersion}`);
    return true;
  } catch (error) {
    console.error('[Audit Cache] Error storing cached audit:', error.message);
    // Fail gracefully - don't break audit flow on cache write error
    return null;
  }
};

/**
 * Clear old cache entries (older than specified days)
 * Useful for periodic cache cleanup and rules version updates
 * @param {number} daysOld - Delete entries older than this many days
 * @returns {object} { deletedCount }
 */
export const clearOldCacheEntries = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await AuditCache.deleteMany({ 
      createdAt: { $lt: cutoffDate } 
    });

    console.log(`[Audit Cache] Cleared ${result.deletedCount} entries older than ${daysOld} days`);
    return result;
  } catch (error) {
    console.error('[Audit Cache] Error clearing old entries:', error.message);
    return { deletedCount: 0 };
  }
};

/**
 * Get cache statistics
 * @returns {object} Cache statistics
 */
export const getCacheStats = async () => {
  try {
    const totalEntries = await AuditCache.countDocuments();
    const totalHits = await AuditCache.aggregate([
      { $group: { _id: null, totalHits: { $sum: '$hitCount' } } }
    ]);

    return {
      totalCachedAudits: totalEntries,
      totalCacheHits: totalHits[0]?.totalHits || 0,
      averageHitsPerAudit: totalEntries > 0 
        ? Math.round((totalHits[0]?.totalHits || 0) / totalEntries) 
        : 0
    };
  } catch (error) {
    console.error('[Audit Cache] Error getting stats:', error.message);
    return { totalCachedAudits: 0, totalCacheHits: 0, averageHitsPerAudit: 0 };
  }
};

export default {
  getCachedAudit,
  storeCachedAudit,
  clearOldCacheEntries,
  getCacheStats
};
