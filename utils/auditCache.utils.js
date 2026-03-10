import crypto from 'crypto';

/**
 * Normalize text content for deterministic hashing
 * Applies consistent formatting to ensure identical content always produces same hash
 * @param {string} text - Raw text to normalize
 * @returns {string} Normalized text
 */
export const normalizeContent = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim()                      // Remove leading/trailing space
    .toLowerCase();              // Lowercase for consistency
};

/**
 * Generate SHA256 hash for audit content
 * Used to check if identical content has been audited before
 * @param {string} text - Normalized text content
 * @param {string} rulesVersion - Current rules version
 * @returns {string} SHA256 hash hex string
 */
export const generateAuditHash = (text, rulesVersion = 'v1') => {
  if (!text) {
    throw new Error('Cannot generate hash for empty text');
  }
  
  // Hash the combination of normalized text + rules version
  // This ensures different rule versions produce different hashes
  return crypto
    .createHash('sha256')
    .update(text + '|' + rulesVersion)
    .digest('hex');
};

/**
 * Create normalized content with hash for caching
 * @param {string} text - Raw text content
 * @param {string} rulesVersion - Rules version
 * @returns {object} { normalizedText, contentHash }
 */
export const createContentCache = (text, rulesVersion = 'v1') => {
  const normalizedText = normalizeContent(text);
  const contentHash = generateAuditHash(normalizedText, rulesVersion);
  
  return {
    normalizedText,
    contentHash
  };
};

/**
 * Calculate similarity score between two audit results (0-100)
 * Used to determine if audit results are stable
 * @param {object} result1 - First audit result
 * @param {object} result2 - Second audit result
 * @returns {number} Similarity percentage
 */
export const calculateResultSimilarity = (result1, result2) => {
  if (!result1 || !result2) return 0;
  
  const score1 = result1.score || result1.complianceScore || 0;
  const score2 = result2.score || result2.complianceScore || 0;
  
  // Calculate percentage difference in scores
  const maxScore = Math.max(score1, score2);
  if (maxScore === 0) return 100; // Both zero scores are similar
  
  const diff = Math.abs(score1 - score2);
  const similarity = ((maxScore - diff) / maxScore) * 100;
  
  return Math.round(similarity);
};

export default {
  normalizeContent,
  generateAuditHash,
  createContentCache,
  calculateResultSimilarity
};
