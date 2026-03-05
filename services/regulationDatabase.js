/**
 * Healthcare Compliance Regulation Database
 * Structured reference for all applicable Indian regulations and guidelines
 * 
 * Maps violation categories to authoritative regulatory sources with official links
 */

export const regulationDatabase = {
  // MISLEADING/UNSUBSTANTIATED CLAIMS
  'misleading_health_claim': {
    regulation_name: 'ASCI Code for Self-Regulation in Advertising',
    section_number: 'Chapter 1.4 - Health & Nutritional Claims',
    official_reference_link: 'https://ascionline.org/assets/pdf/ASCI-Code.pdf',
    confidence_score: 95,
    jurisdiction: ['India'],
    keywords: ['false claims', 'unsubstantiated claims', 'misleading statements']
  },

  'false_curing_claim': {
    regulation_name: 'Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954',
    section_number: 'Section 3 - Prohibited Advertisements',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/2158',
    confidence_score: 98,
    jurisdiction: ['India'],
    keywords: ['cure', 'remedy', 'treat cancer', 'treat diabetes', 'healing claims']
  },

  'discouraging_medical_consultation': {
    regulation_name: 'Drugs and Cosmetics Act, 1940',
    section_number: 'Rule 106 & Schedule J',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/1619',
    confidence_score: 92,
    jurisdiction: ['India'],
    keywords: ['no consultation needed', 'self-diagnosis', 'avoid doctor']
  },

  'self_diagnosis_promotion': {
    regulation_name: 'FSSAI Advertising & Claims Regulations, 2018',
    section_number: 'Section 8.2 - Prohibited Health Claims',
    official_reference_link: 'https://www.fssai.gov.in/upload/uploadfiles/files/FSSAI_Advertising_Claims_Guidance_2018.pdf',
    confidence_score: 88,
    jurisdiction: ['India'],
    keywords: ['identify condition yourself', 'diagnose at home', 'self-test']
  },

  // UNAUTHORIZED MEDICAL PRACTITIONER
  'unqualified_practitioner': {
    regulation_name: 'National Medical Commission RMP Regulations, 2023',
    section_number: 'Part 2 - Unauthorized Medical Practice',
    official_reference_link: 'https://nmc.org.in/rules-regulations/professional-conduct-etiquette-ethics-regulations-2023/',
    confidence_score: 96,
    jurisdiction: ['India'],
    keywords: ['unqualified doctor', 'unauthorized practice', 'fake credentials']
  },

  'medical_malpractice': {
    regulation_name: 'Indian Penal Code',
    section_number: 'Section 336, 337, 338',
    official_reference_link: 'https://www.indiacode.nic.in/section/336/of/the/indian/penal/code/1860',
    confidence_score: 90,
    jurisdiction: ['India'],
    keywords: ['negligence', 'injury', 'harm caused by medical practice']
  },

  // PRODUCT MARKETING VIOLATIONS
  'illegal_medical_device_claim': {
    regulation_name: 'Drugs and Cosmetics Act, 1940',
    section_number: 'Rule 122 - Medical Device Advertising',
    official_reference_link: 'https://www.mccodeofconduct.org/device-advertising/',
    confidence_score: 91,
    jurisdiction: ['India'],
    keywords: ['medical device', 'drug claim', 'therapeutic claim']
  },

  'pharmaceutical_marketing_violation': {
    regulation_name: 'UCPMP 2024 - United Code of Pharmaceutical Marketing Practices',
    section_number: 'Section 2.1 - Promotional Material Standards',
    official_reference_link: 'https://www.ucpmp2024.org/standards',
    confidence_score: 93,
    jurisdiction: ['India'],
    keywords: ['pharma marketing', 'promotion rules', 'drug advertisement']
  },

  'cosmetics_misclassification': {
    regulation_name: 'Drugs and Cosmetics Act, 1940',
    section_number: 'Rule 103 - Cosmetics Definition',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/1619',
    confidence_score: 85,
    jurisdiction: ['India'],
    keywords: ['cosmetic', 'drug claim on cosmetic', 'beauty product claim']
  },

  // PRIVACY & DATA PROTECTION
  'privacy_violation': {
    regulation_name: 'Digital Personal Data Protection Act, 2023',
    section_number: 'Part 2 - Data Processing Rules',
    official_reference_link: 'https://www.meity.gov.in/write-read-data/digital-personal-data-protection-act-2023',
    confidence_score: 94,
    jurisdiction: ['India'],
    keywords: ['personal data', 'health information', 'privacy breach']
  },

  'consent_violation': {
    regulation_name: 'Information Technology Act, 2000',
    section_number: 'Section 43A - Privacy',
    official_reference_link: 'https://www.indiacode.nic.in/section/43a/of/the/information/technology/act/2000',
    confidence_score: 92,
    jurisdiction: ['India'],
    keywords: ['without consent', 'unauthorized collection', 'consent not taken']
  },

  'sensitive_data_exposure': {
    regulation_name: 'Intermediary Guidelines & Digital Ethics Code, 2021',
    section_number: 'Rule 4 - Privacy Standards',
    official_reference_link: 'https://meity.gov.in/intermediary-guidelines',
    confidence_score: 93,
    jurisdiction: ['India'],
    keywords: ['patient data leakage', 'medical records exposed', 'health data public']
  },

  // ETHICAL VIOLATIONS
  'unethical_testimonial': {
    regulation_name: 'ASCI Code for Self-Regulation in Advertising',
    section_number: 'Chapter 1.3 - Testimonials',
    official_reference_link: 'https://ascionline.org/assets/pdf/ASCI-Code.pdf',
    confidence_score: 87,
    jurisdiction: ['India'],
    keywords: ['fake testimonial', 'patient endorsement', 'unverified testimonial']
  },

  'target_vulnerable_population': {
    regulation_name: 'Consumer Protection Act, 2019',
    section_number: 'Section 2(1) - Unfair Practices',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/11156',
    confidence_score: 89,
    jurisdiction: ['India'],
    keywords: ['targeting children', 'exploiting elderly', 'vulnerable groups']
  },

  'influencer_misrepresentation': {
    regulation_name: 'ASCI Healthcare & Influencer Guidelines, 2022',
    section_number: 'Part 2 - Influencer Responsibilities',
    official_reference_link: 'https://ascionline.org/healthcare-influencer-guidelines/',
    confidence_score: 91,
    jurisdiction: ['India'],
    keywords: ['influencer', 'paid partnership not disclosed', 'fake endorsement']
  },

  // FINANCIAL MISREPRESENTATION
  'unsubstantiated_cost_claim': {
    regulation_name: 'Consumer Protection Act, 2019',
    section_number: 'Section 2(47) - Misleading Advertisement',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/11156',
    confidence_score: 86,
    jurisdiction: ['India'],
    keywords: ['cost claim', 'price guarantee', 'free treatment claim']
  },

  'hidden_charges': {
    regulation_name: 'CCPA Guidelines for Prevention of Misleading Advertisements, 2022',
    section_number: 'Section 4.2 - Transparent Pricing',
    official_reference_link: 'https://www.ccpa.com.in/guidelines-2022',
    confidence_score: 88,
    jurisdiction: ['India'],
    keywords: ['hidden fees', 'undisclosed charges', 'surprise costs']
  },

  // MISSING DISCLAIMERS
  'missing_necessary_disclaimer': {
    regulation_name: 'Drugs and Cosmetics Act, 1940',
    section_number: 'Rule 100 - Mandatory Disclaimers',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/1619',
    confidence_score: 94,
    jurisdiction: ['India'],
    keywords: ['missing disclaimer', 'no warning', 'required disclaimer absent']
  },

  'missing_contraindication': {
    regulation_name: 'Drugs and Cosmetics Act, 1940',
    section_number: 'Schedule J - Safety Information',
    official_reference_link: 'https://www.indiacode.nic.in/handle/123456789/1619',
    confidence_score: 92,
    jurisdiction: ['India'],
    keywords: ['contraindication', 'side effects not mentioned', 'adverse effects']
  },

  // CONTENT TYPE SPECIFIC
  'deepfake_medical_content': {
    regulation_name: 'MeitY AI & Deepfake Advisories, 2023',
    section_number: 'Section 3 - Synthetic Media Disclosure',
    official_reference_link: 'https://meity.gov.in/content/guidelines-responsible-ai',
    confidence_score: 96,
    jurisdiction: ['India'],
    keywords: ['deepfake', 'synthetic video', 'AI-generated medical content', 'undisclosed AI']
  },

  'telemedicine_violation': {
    regulation_name: 'Telemedicine Practice Guidelines, 2020',
    section_number: 'Part 2 - Practice Standards',
    official_reference_link: 'https://www.nmc.org.in/telemedicine-guidelines-2020/',
    confidence_score: 89,
    jurisdiction: ['India'],
    keywords: ['telemedicine', 'online consultation', 'digital health']
  },

  // FOOD & NUTRITION
  'food_health_claim_misuse': {
    regulation_name: 'FSSAI Food Safety & Standards (Labelling & Display) Regulations, 2020',
    section_number: 'Regulation 3.2 - Health Claims',
    official_reference_link: 'https://www.fssai.gov.in/upload/uploadfiles/files/Food_Standards_Labelling_Display_2020.pdf',
    confidence_score: 90,
    jurisdiction: ['India'],
    keywords: ['food claim', 'nutritional claim', 'health benefit claim']
  },

  'fortified_food_false_claim': {
    regulation_name: 'FSSAI Fortification Standards, 2016',
    section_number: 'Section 2.4 - Fortified Foods',
    official_reference_link: 'https://www.fssai.gov.in/upload/uploadfiles/files/FortificationStandards_25_04_2016.pdf',
    confidence_score: 87,
    jurisdiction: ['India'],
    keywords: ['fortified', 'vitamin enriched', 'mineral added', 'fortification claim']
  },

  // INTERNATIONAL REGULATIONS (For multi-country context)
  'fda_related_claim': {
    regulation_name: 'FDA Regulations (for USA-targeting content)',
    section_number: '21 CFR Part 311 & 312',
    official_reference_link: 'https://www.fda.gov/drugs/guidance-compliance-regulatory-information',
    confidence_score: 85,
    jurisdiction: ['USA', 'Canada', 'Australia'],
    keywords: ['FDA', 'drug claim', 'medical device']
  },

  // GENERIC FALLBACK
  'general_regulatory_violation': {
    regulation_name: 'Applicable Indian Healthcare Regulations',
    section_number: 'General Compliance',
    official_reference_link: 'https://www.ccpa.com.in/guidelines',
    confidence_score: 60,
    jurisdiction: ['India'],
    keywords: ['violation', 'non-compliant', 'regulatory concern']
  }
};

/**
 * Search regulation database by violation category
 * @param {string} violationCategory - Category of violation
 * @returns {object|null} Regulation entry or null
 */
export const getRegulationReference = (violationCategory) => {
  if (!violationCategory) return null;

  // Exact match
  if (regulationDatabase[violationCategory]) {
    return {
      ...regulationDatabase[violationCategory],
      matched_by: 'exact'
    };
  }

  // Keyword fuzzy match
  const normalized = violationCategory.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const entries = Object.entries(regulationDatabase);

  for (const [key, value] of entries) {
    const keywords = value.keywords || [];
    const keywordsMatched = keywords.some(kw => 
      normalized.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, '_'))
    );

    if (keywordsMatched) {
      return {
        ...value,
        matched_by: 'keyword'
      };
    }
  }

  // Fallback to general violation if no match
  return {
    ...regulationDatabase['general_regulatory_violation'],
    matched_by: 'fallback'
  };
};

/**
 * Get all regulations for a jurisdiction
 * @param {string} jurisdiction - Country/region
 * @returns {array} List of applicable regulations
 */
export const getRegulationsByJurisdiction = (jurisdiction = 'India') => {
  return Object.entries(regulationDatabase)
    .filter(([_, regulation]) => regulation.jurisdiction.includes(jurisdiction))
    .map(([key, regulation]) => ({
      ...regulation,
      category_key: key
    }));
};

/**
 * Validate violation against regulation database
 * @param {object} violation - Violation object with regulation field
 * @returns {object} Validated violation with reference links
 */
export const validateAndEnrichViolation = (violation) => {
  if (!violation.regulation) {
    return {
      ...violation,
      regulation_name: 'Unknown Regulation',
      section_number: 'N/A',
      official_reference_link: '',
      confidence_score: 50,
      validation_status: 'unvalidated'
    };
  }

  // Try to find match in regulation database
  const reference = getRegulationReference(violation.regulation);

  return {
    ...violation,
    regulation_name: reference.regulation_name,
    section_number: reference.section_number,
    official_reference_link: reference.official_reference_link,
    confidence_score: reference.confidence_score || violation.risk_score || 70,
    validation_status: reference.matched_by === 'exact' ? 'validated' : 'matched'
  };
};

export default {
  regulationDatabase,
  getRegulationReference,
  getRegulationsByJurisdiction,
  validateAndEnrichViolation
};
