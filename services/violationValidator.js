/**
 * Violation Validator Service
 * Validates and enriches AI-generated violations with authoritative regulation references
 * Provides a structured validation layer for compliance audit results
 */

import {
  getRegulationReference,
  getRegulationsByJurisdiction,
  validateAndEnrichViolation as enrichViolation
} from './regulationDatabase.js';

/**
 * Validate a single violation against the regulation database
 * @param {object} violation - Violation object from AI model
 * @param {object} options - Enrichment options
 * @returns {object} Validated and enriched violation
 */
export const validateViolation = (violation, options = {}) => {
  const {
    jurisdiction = 'India',
    mapToRegulation = true,
    addConfidenceScore = true
  } = options;

  if (!violation || typeof violation !== 'object') {
    console.warn('[Violation Validator] Invalid violation object provided');
    return null;
  }

  // Start with base violation
  const validated = { ...violation };

  if (mapToRegulation) {
    // Attempt to map violation to regulation database
    const regulationKey = extractViolationCategory(violation);
    const reference = getRegulationReference(regulationKey);

    if (reference) {
      // Add regulation reference fields
      validated.regulation_name = reference.regulation_name;
      validated.section_number = reference.section_number;
      validated.official_reference_link = reference.official_reference_link;
      validated.violation_category = regulationKey;
      validated.regulation_match_confidence = reference.confidence_score;
    } else {
      // Fallback fields if no match found
      validated.regulation_name = violation.regulation || 'Applicable Indian Healthcare Regulation';
      validated.section_number = 'General Compliance';
      validated.official_reference_link = 'https://www.ccpa.com.in/guidelines';
      validated.violation_category = 'general_regulatory_violation';
      validated.regulation_match_confidence = 60;
    }
  }

  if (addConfidenceScore) {
    // Calculate overall confidence score
    // Combines regulation match confidence with AI risk score
    const aiConfidence = violation.risk_score || 70;
    const regulationConfidence = validated.regulation_match_confidence || 70;
    validated.confidence_score = Math.round((aiConfidence + regulationConfidence) / 2);
  }

  // Ensure all required fields are present
  return normalizeValidatedViolation(validated);
};

/**
 * Extract violation category from violation text
 * Uses evidence and violation_title to classify the type of violation
 * @param {object} violation - Violation object
 * @returns {string} Violation category key
 */
const extractViolationCategory = (violation) => {
  const text = `${violation.violation_title || ''} ${violation.evidence || ''} ${violation.description || ''}`.toLowerCase();

  // Check for specific violation categories
  const categoryPatterns = {
    'false_curing_claim': [
      'cure', 'remedy', 'heals', 'cures cancer', 'cures diabetes',
      'treats cancer', 'healing', 'heal', 'complete cure'
    ],
    'misleading_health_claim': [
      'false claim', 'unsubstantiated', 'misleading', 'fabricated',
      'without evidence', 'not proven', 'alleged'
    ],
    'discouraging_medical_consultation': [
      'no doctor needed', 'no consultation', 'avoid doctor',
      'without consulting', 'no medical advice', 'self-treat'
    ],
    'self_diagnosis_promotion': [
      'diagnose yourself', 'self-diagnosis', 'at-home diagnosis',
      'identify your condition', 'self-test'
    ],
    'unqualified_practitioner': [
      'unqualified', 'unlicensed', 'fake doctor', 'unauthorized',
      'credentials questionable'
    ],
    'illegal_medical_device_claim': [
      'medical device', 'therapy device', 'treatment device',
      'FDA approved', 'device claim'
    ],
    'pharmaceutical_marketing_violation': [
      'drug', 'pharmaceutical', 'medicine', 'medication',
      'pharma marketing'
    ],
    'missing_necessary_disclaimer': [
      'missing disclaimer', 'no warning', 'required disclaimer',
      'disclaimer absent', 'not disclosed'
    ],
    'privacy_violation': [
      'personal data', 'patient information', 'health data',
      'privacy breach', 'data leakage'
    ],
    'deepfake_medical_content': [
      'deepfake', 'synthetic', 'ai-generated', 'fake video',
      'not real footage'
    ],
    'influencer_misrepresentation': [
      'influencer', 'endorsement', 'testimonial', 'celebrity',
      'paid partnership not disclosed'
    ]
  };

  // Score each category based on pattern matches
  let bestMatch = 'general_regulatory_violation';
  let bestScore = 0;

  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    let score = 0;
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = category;
    }
  }

  return bestMatch;
};

/**
 * Normalize validated violation to ensure all required fields exist
 * Maintains backward compatibility with existing violation format
 * @param {object} violation - Validated violation object
 * @returns {object} Normalized violation with all required fields
 */
const normalizeValidatedViolation = (violation) => {
  return {
    // Original fields (backward compatibility)
    severity: violation.severity || 'MEDIUM',
    regulation: violation.regulation || violation.regulation_name || 'Applicable Regulation',
    violation_title: violation.violation_title || 'Regulatory Violation Detected',
    evidence: violation.evidence || 'Evidence not provided',
    translation: violation.translation || violation.evidence,
    guidance: Array.isArray(violation.guidance) ? violation.guidance : [violation.guidance || ''],
    fix: Array.isArray(violation.fix) ? violation.fix : [violation.fix || ''],
    risk_score: violation.risk_score || 70,

    // New enriched fields
    regulation_name: violation.regulation_name || 'Applicable Indian Healthcare Regulation',
    section_number: violation.section_number || 'General Compliance',
    official_reference_link: violation.official_reference_link || 'https://www.ccpa.com.in/guidelines',
    confidence_score: violation.confidence_score || violation.risk_score || 70,

    // Additional metadata
    violation_category: violation.violation_category || 'general_regulatory_violation',
    validation_status: violation.validation_status || 'validated',
    regulation_match_confidence: violation.regulation_match_confidence || 70
  };
};

/**
 * Validate all violations in a compliance response
 * @param {array} violations - Array of violation objects
 * @param {object} options - Global enrichment options
 * @returns {array} Array of validated violations
 */
export const validateViolations = (violations, options = {}) => {
  if (!Array.isArray(violations)) {
    console.warn('[Violation Validator] Expected array of violations');
    return [];
  }

  return violations
    .filter(v => v && typeof v === 'object') // Remove invalid entries
    .map(violation => validateViolation(violation, options));
};

/**
 * Enrich compliance audit response with validation
 * @param {object} auditResponse - Response from AI audit service
 * @param {object} options - Enrichment options
 * @returns {object} Enriched audit response with validated violations
 */
export const validateAuditResponse = (auditResponse, options = {}) => {
  if (!auditResponse) {
    console.warn('[Violation Validator] Invalid audit response');
    return {
      complianceScore: 100,
      violations: [],
      validationStatus: 'error'
    };
  }

  const enriched = { ...auditResponse };

  // Validate violations if present
  if (Array.isArray(auditResponse.violations) && auditResponse.violations.length > 0) {
    enriched.violations = validateViolations(auditResponse.violations, options);

    // Recalculate compliance score based on validated violations
    enriched.complianceScore = calculateEnrichedComplianceScore(enriched.violations);
  }

  // Add validation metadata
  enriched.validation_metadata = {
    validated_at: new Date().toISOString(),
    total_violations: enriched.violations.length,
    critical_violations: enriched.violations.filter(v => v.severity === 'CRITICAL').length,
    high_violations: enriched.violations.filter(v => v.severity === 'HIGH').length,
    average_confidence_score: enriched.violations.length > 0
      ? Math.round(enriched.violations.reduce((sum, v) => sum + (v.confidence_score || 70), 0) / enriched.violations.length)
      : 100,
    validation_status: 'complete'
  };

  return enriched;
};

/**
 * Calculate compliance score based on enriched violations
 * @param {array} validatedViolations - Array of validated violations
 * @returns {number} Recalculated compliance score (0-100)
 */
const calculateEnrichedComplianceScore = (validatedViolations) => {
  if (!validatedViolations || validatedViolations.length === 0) {
    return 100;
  }

  // Penalty calculation based on severity and confidence
  let totalPenalty = 0;

  for (const violation of validatedViolations) {
    const severityWeights = {
      'CRITICAL': 30,
      'HIGH': 20,
      'MEDIUM': 10,
      'LOW': 5
    };

    const weight = severityWeights[violation.severity] || 10;
    const confidence = (violation.confidence_score || 70) / 100;

    totalPenalty += weight * confidence;
  }

  // Cap at 100% compliance loss, minimum 0%
  return Math.max(0, 100 - totalPenalty);
};

/**
 * Generate compliance report with validation summary
 * @param {object} validatedAuditResponse - Enriched audit response
 * @returns {object} Compliance report with validation details
 */
export const generateValidationReport = (validatedAuditResponse) => {
  if (!validatedAuditResponse) {
    return {
      status: 'error',
      message: 'Invalid audit response'
    };
  }

  const violations = validatedAuditResponse.violations || [];
  const bySeverity = {
    CRITICAL: violations.filter(v => v.severity === 'CRITICAL'),
    HIGH: violations.filter(v => v.severity === 'HIGH'),
    MEDIUM: violations.filter(v => v.severity === 'MEDIUM'),
    LOW: violations.filter(v => v.severity === 'LOW')
  };

  // Group by regulation
  const byRegulation = {};
  for (const violation of violations) {
    const regName = violation.regulation_name || 'Unknown';
    if (!byRegulation[regName]) {
      byRegulation[regName] = [];
    }
    byRegulation[regName].push(violation);
  }

  return {
    compliance_score: validatedAuditResponse.complianceScore || 100,
    status: validatedAuditResponse.status || 'Compliant',
    summary: validatedAuditResponse.summary || 'No violations detected',
    
    violation_summary: {
      total: violations.length,
      critical: bySeverity.CRITICAL.length,
      high: bySeverity.HIGH.length,
      medium: bySeverity.MEDIUM.length,
      low: bySeverity.LOW.length
    },

    violations_by_regulation: Object.entries(byRegulation).map(([regulation, viols]) => ({
      regulation_name: regulation,
      count: viols.length,
      violations: viols
    })),

    validation_metadata: validatedAuditResponse.validation_metadata || {
      validated_at: new Date().toISOString(),
      validation_status: 'pending'
    }
  };
};

export default {
  validateViolation,
  validateViolations,
  validateAuditResponse,
  generateValidationReport
};
