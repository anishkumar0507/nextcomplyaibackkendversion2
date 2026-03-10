import AuditCache from '../models/AuditCache.js';

/**
 * Check if audit result exists in cache
 * Returns cached result if found and updates access metadata
 * @param {string} auditHash - SHA256 hash of normalized content
 * @param {string} rulesVersion - Rules version to match
 * @returns {object|null} Cached audit result or null if not found
 */
export const getCachedAudit = async (auditHash, rulesVersion = 'v1') => {
  try {
    const cached = await AuditCache.findOne({ 
      auditHash, 
      rulesVersion 
    });

    if (cached) {
      console.log(`[Audit Cache] HIT - Hash: ${auditHash.substring(0, 16)}... | Rules: ${rulesVersion}`);
      
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

    console.log(`[Audit Cache] MISS - Hash: ${auditHash.substring(0, 16)}... | Rules: ${rulesVersion}`);
    return null;
  } catch (error) {
    console.error('[Audit Cache] Error retrieving cached audit:', error.message);
    // Fail gracefully - continue without cache on error
    return null;
  }
};

/**
 * Store audit result in cache
 * @param {string} auditHash - SHA256 hash of normalized content
 * @param {string} transcript - Normalized transcript/text that was audited
 * @param {object} auditResult - Full audit result from Gemini
 * @param {number} score - Compliance score
 * @param {string} rulesVersion - Rules version used
 * @returns {object} Stored cache record
 */
export const storeCachedAudit = async (auditHash, transcript, auditResult, score, rulesVersion = 'v1') => {
  try {
    // Check if already exists (race condition safeguard)
    const existing = await AuditCache.findOne({ auditHash, rulesVersion });
    
    if (existing) {
      console.log(`[Audit Cache] Already cached - Hash: ${auditHash.substring(0, 16)}... | Rules: ${rulesVersion}`);
      return existing;
    }

    const cached = await AuditCache.create({
      auditHash,
      transcript,
      auditResult,
      score,
      rulesVersion,
      createdAt: new Date()
    });

    console.log(`[Audit Cache] Stored - Hash: ${auditHash.substring(0, 16)}... | Score: ${score} | Rules: ${rulesVersion}`);
    return cached;
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
