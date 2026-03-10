import { VertexAI } from "@google-cloud/vertexai";

/* ===============================
   CONFIG
================================ */
const MODEL_NAME = "gemini-2.5-flash";

/**
 * Clean JSON string by removing markdown formatting
 */
const cleanJsonString = (text = "") => {
  return text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
};

/**
 * Extract JSON object using regex pattern
 * Captures the first complete JSON object from text
 */
const extractJsonCandidate = (text = "") => {
  // First try: Find first complete JSON object using regex
  const jsonMatch = text.match(/{[\s\S]*}/);
  if (jsonMatch) {
    return jsonMatch[0].trim();
  }
  
  // Fallback: Use indexOf/lastIndexOf
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return text.trim();
  }
  return text.slice(start, end + 1).trim();
};

/**
 * Repair common JSON formatting issues
 * - Remove trailing commas before closing brackets
 * - Fix double commas
 * - Remove invalid characters after closing brace
 */
const repairJsonString = (jsonStr) => {
  let repaired = jsonStr
    // Remove trailing commas before closing brackets/braces
    .replace(/,\s*([}\]])/g, '$1')
    // Fix double commas
    .replace(/,,+/g, ',')
    // Remove any content after the final closing brace
    .replace(/(})\s*[^}]*$/, '$1')
    // Normalize whitespace
    .trim();
  
  return repaired;
};

/**
 * Try to parse JSON with multiple fallback strategies
 */
const tryParseJson = (text) => {
  const cleaned = cleanJsonString(text);
  const candidate = extractJsonCandidate(cleaned);
  
  // Attempt 1: Direct parse
  try {
    const parsed = JSON.parse(candidate);
    console.log('[Gemini Parser] ✓ Extracted JSON successfully (direct parse)');
    return parsed;
  } catch (e) {
    console.log('[Gemini Parser] Direct parse failed, attempting repair...');
  }
  
  // Attempt 2: Repair and parse
  try {
    const repaired = repairJsonString(candidate);
    const parsed = JSON.parse(repaired);
    console.log('[Gemini Parser] ✓ JSON repaired and parsed successfully');
    return parsed;
  } catch (e) {
    console.log('[Gemini Parser] Repair parse failed, using fallback extraction...');
  }
  
  // Attempt 3: Extract only the content between first { and last }
  try {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const extracted = candidate.substring(firstBrace, lastBrace + 1);
      const repaired = repairJsonString(extracted);
      const parsed = JSON.parse(repaired);
      console.log('[Gemini Parser] ✓ Using fallback extraction and parsing');
      return parsed;
    }
  } catch (e) {
    console.log('[Gemini Parser] Fallback extraction failed');
  }
  
  // All attempts failed
  throw new Error('Failed to parse JSON after all repair attempts');
};

/* ===============================
   PROMPT (VERY IMPORTANT)
================================ */
const buildRulesBlock = (rules = []) => {
  if (!rules.length) {
    return 'No rule pack provided. Use best-effort compliance reasoning based on jurisdiction.';
  }

  const maxRules = 50;
  const lines = rules.slice(0, maxRules).map((rule, index) => {
    const section = rule.section ? ` (Section: ${rule.section})` : '';
    return `${index + 1}. ${rule.regulation} - ${rule.title}${section}`;
  });

  if (rules.length > maxRules) {
    lines.push(`...and ${rules.length - maxRules} more rules in this jurisdiction.`);
  }

  return lines.join('\n');
};

const buildCompliancePrompt = ({ inputType, category, analysisMode, country, region, rules, contentContext }) => {
  const jurisdiction = country ? country : 'India';
  const regionLabel = region ? ` (${region})` : '';
  const rulesBlock = buildRulesBlock(rules);
  const contextBlock = contentContext
    ? `\nCONTENT CONTEXT (MANDATORY):\n${contentContext}\n`
    : '';

  return `
You are NextComply AI, a senior regulatory compliance auditor for ${jurisdiction}${regionLabel}.

TASK:
Audit the given ${inputType} content for ${jurisdiction}${regionLabel} advertising & healthcare compliance.

${contextBlock}

RULE PACK (MANDATORY):
Use ONLY the rules listed below to identify violations and generate fixes.
${rulesBlock}

CRITICAL OUTPUT RULES:
- Return ONLY valid JSON - NO explanations, NO markdown, NO extra text
- Do NOT include transcription or full HTML content in response
- Do NOT repeat points
- Do NOT restart numbering
- Each recommendation must be ACTIONABLE and REPLACEMENT-BASED

RECOMMENDATION STYLE (VERY IMPORTANT):
❌ Wrong: "Remove misleading claim"
✅ Correct:
"Replace the sentence:
  'This medicine cures diabetes permanently'
 with:
  'This product may help support diabetes management when used under medical supervision.'"

FORMAT RULES:
- suggestion: numbered points (1., 2., 3.)
- solution: numbered points (1., 2., 3.)
- Max 3 points per field
- If only 1 point exists, return ONLY "1."

JSON SCHEMA (RETURN ONLY THIS STRUCTURE):
{
  "score": number,
  "status": "Compliant" | "Needs Review" | "Non-Compliant",
  "summary": string,
  "financialPenalty": {
    "riskLevel": "High" | "Medium" | "Low" | "None",
    "description": string
  },
  "ethicalMarketing": {
    "score": number,
    "assessment": string
  },
  "violations": [
    {
      "severity": "Critical" | "High" | "Medium" | "Low",
      "regulation": string,
      "description": string,
      "problematicContent": string,
      "englishTranslation": string,
      "suggestion": string,
      "solution": string
    }
  ]
}

ANALYSIS MODE: ${analysisMode || "Standard"}
INDUSTRY DOMAIN: ${category || "General"}

IMPORTANT: Return ONLY the JSON object above. Do not include any other text.`;
};

/* ===============================
   MAIN FUNCTION (EXPORTED)
================================ */
export const analyzeWithGemini = async ({
  content,
  inputType = "text",
  category = "General",
  analysisMode = "Standard",
  country,
  region,
  rules = [],
  contentContext = ''
}) => {
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION;
  
  console.log('[Gemini Service - analyzeWithGemini] Initializing Vertex AI client...');
  console.log('[Gemini Service - analyzeWithGemini] Project ID:', projectId);
  console.log('[Gemini Service - analyzeWithGemini] Location:', location);
  
  if (!projectId) {
    throw new Error("VERTEX_PROJECT_ID missing");
  }
  if (!location) {
    throw new Error("VERTEX_LOCATION missing");
  }

  const vertexAI = new VertexAI({
    project: projectId,
    location: location
  });
  console.log("[Gemini Service - analyzeWithGemini] ✓ Vertex initialized (using GOOGLE_APPLICATION_CREDENTIALS)");

  const model = vertexAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,           // Deterministic: always pick best token
      topP: 0.8,               // Deterministic: only consider top 80% of tokens
      topK: 1,                 // Deterministic: only pick from top 1 token (greedy)
      candidateCount: 1,
      maxOutputTokens: 8192,
    },
  });

  const prompt = buildCompliancePrompt({
    inputType,
    category,
    analysisMode,
    country,
    region,
    rules,
    contentContext
  });

  const parts = [
    { text: content },
    { text: prompt },
  ];

  const result = await model.generateContent({
    contents: [{ role: "user", parts }],
  });

  let rawText =
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!rawText) {
    console.error('[Gemini Service] ❌ Empty response from Gemini');
    throw new Error("Gemini returned empty response");
  }

  console.log('[Gemini Parser] Raw response length:', rawText.length, 'chars');

  // Attempt to parse with multiple fallback strategies
  try {
    const parsed = tryParseJson(rawText);
    console.log('[Gemini Parser] ✓ Successfully parsed Gemini response');
    return parsed;
  } catch (err) {
    console.warn('[Gemini Parser] ⚠️ Initial parsing failed:', err.message);
    console.log('[Gemini Parser] Attempting Gemini-powered JSON repair...');
    
    // Log truncated raw output for debugging (first 500 chars)
    const truncatedRaw = rawText.length > 500 ? rawText.substring(0, 500) + '...' : rawText;
    console.log('[Gemini Parser] Raw output preview:', truncatedRaw);

    // Repair attempt: ask Gemini to fix JSON only
    const repairPrompt = `The following response contains invalid JSON. Fix it and return ONLY a valid JSON object with no additional text, explanations, or markdown formatting.\n\nINVALID JSON:\n${rawText}\n\nReturn ONLY the corrected JSON object.`;
    
    try {
      const repairResult = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: repairPrompt }] }],
      });

      const repairText =
        repairResult?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!repairText) {
        console.error('[Gemini Parser] ❌ Repair attempt returned empty response');
        throw new Error("Gemini JSON repair returned empty response");
      }

      console.log('[Gemini Parser] Repair response length:', repairText.length, 'chars');
      
      const parsed = tryParseJson(repairText);
      console.log('[Gemini Parser] ✓ Successfully parsed repaired JSON');
      return parsed;
    } catch (repairError) {
      console.error('[Gemini Parser] ❌ JSON repair failed:', repairError.message);
      
      throw new Error(`Gemini returned unparseable JSON. Initial error: ${err.message}. Repair error: ${repairError.message}`);
    }
  }
};

/* ===============================
   OPTIONAL: AUDIO SUMMARY
================================ */
export const generateAudioSummary = async (text) => {
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION;
  
  console.log('[Gemini Service - generateAudioSummary] Initializing Vertex AI client...');
  console.log('[Gemini Service - generateAudioSummary] Project ID:', projectId);
  console.log('[Gemini Service - generateAudioSummary] Location:', location);
  
  if (!projectId) {
    throw new Error("VERTEX_PROJECT_ID missing");
  }
  if (!location) {
    throw new Error("VERTEX_LOCATION missing");
  }
  const vertexAI = new VertexAI({
    project: projectId,
    location: location
  });
  console.log("[Gemini Service - generateAudioSummary] ✓ Vertex initialized (using GOOGLE_APPLICATION_CREDENTIALS)");

  const ttsModel = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-tts",
  });

  const result = await ttsModel.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
  });

  const audioBase64 =
    result?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!audioBase64) {
    throw new Error("Audio generation failed");
  }

  return audioBase64;
};

export const extractClaimsWithGemini = async (text) => {
  const projectId = process.env.VERTEX_PROJECT_ID;
  const location = process.env.VERTEX_LOCATION;
  
  console.log('[Gemini Service - extractClaimsWithGemini] Initializing Vertex AI client...');
  console.log('[Gemini Service - extractClaimsWithGemini] Project ID:', projectId);
  console.log('[Gemini Service - extractClaimsWithGemini] Location:', location);
  
  if (!projectId) {
    throw new Error('VERTEX_PROJECT_ID missing');
  }
  if (!location) {
    throw new Error('VERTEX_LOCATION missing');
  }

  const cleaned = (text || '').trim();
  if (!cleaned) {
    throw new Error('No text provided for claim extraction');
  }

  const vertexAI = new VertexAI({
    project: projectId,
    location: location
  });
  console.log("[Gemini Service - extractClaimsWithGemini] ✓ Vertex initialized (using GOOGLE_APPLICATION_CREDENTIALS)");

  const model = vertexAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      temperature: 0,
      topP: 1,
      candidateCount: 1,
      maxOutputTokens: 2048
    }
  });

  const prompt = `Extract the key marketing, medical, and compliance-relevant claims from the following document text. Return plain text only. Do NOT include JSON or markdown. If no claims are present, return a short sentence stating that no explicit claims were found.`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n${cleaned.substring(0, 16000)}` }] }]
  });

  const output = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const extracted = output.trim();

  if (!extracted) {
    throw new Error('Gemini claim extraction returned empty output');
  }

  const lower = extracted.toLowerCase();
  const isNoClaims = lower.includes('no explicit claims') || lower.includes('no clear claims');
  if (!isNoClaims && extracted.length < 80) {
    throw new Error('Gemini claim extraction returned too-short output');
  }

  return extracted;
};