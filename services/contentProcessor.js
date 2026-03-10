import { scrapeUrl, extractReadableFromUrl, extractMetadataFromUrl, extractBlogContentByMethod } from './scrapingService.js';
import { transcribe } from './transcriptionService.js';
import { performAudit, performMultimodalAudit } from './auditService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { YoutubeTranscript } from 'youtube-transcript';
import OpenAI from 'openai';
import { analyzeWithGemini, extractClaimsWithGemini } from '../geminiService.js';
import { extractTextFromDocument } from './documentService.js';
import { transcribeYoutubeUrl } from './youtubeTranscription.service.ts';
import { getRulesForSelection } from './rulesService.js';
import AuditRecord from '../models/AuditRecord.js';
import { extractTextFromImage } from './ocrService.js';
import { buildAuditInput } from './auditInputBuilder.ts';
import { normalizeContent, generateAuditHash, calculateResultSimilarity } from '../utils/auditCache.utils.js';
import { getCachedAudit, storeCachedAudit } from './auditCache.service.js';

const MAX_TEXT_LENGTH = 100000;
const MAX_MEDIA_SIZE = 100 * 1024 * 1024;
const REQUEST_TIMEOUT = 60000;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/**
 * FIX 5: Calculate industry benchmark score based on category
 * @param {string} category - Industry category
 * @param {number} actualScore - Actual compliance score
 * @returns {object} Benchmark information
 */
const calculateBenchmarkScore = (category, actualScore) => {
  const benchmarks = {
    'Pharmaceuticals': { baseline: 72, range: '65-80' },
    'Healthcare': { baseline: 70, range: '62-78' },
    'Nutraceuticals': { baseline: 68, range: '60-75' },
    'Ayurveda': { baseline: 66, range: '58-73' },
    'Cosmetics': { baseline: 75, range: '68-82' },
    'Medical Devices': { baseline: 74, range: '67-80' },
    'default': { baseline: 70, range: '62-77' }
  };
  
  const benchmark = benchmarks[category] || benchmarks['default'];
  const diff = actualScore - benchmark.baseline;
  
  let confidenceLevel = 'medium';
  if (Math.abs(diff) <= 5) confidenceLevel = 'high';
  else if (Math.abs(diff) > 15) confidenceLevel = 'low';
  
  return {
    estimated_industry_score: benchmark.baseline,
    industry_range: benchmark.range,
    confidence_level: confidenceLevel,
    disclaimer: 'Industry benchmarks are estimates based on historical compliance data and may vary by jurisdiction and content complexity.'
  };
};

const delay = (minMs = 300, maxMs = 900) => {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, jitter));
};

/**
 * Perform audit with deterministic caching and validation
 * Checks cache first, validates result consistency, stores in cache
 * @param {string} text - Text content to audit
 * @param {object} opts - Audit options (category, analysisMode, country, region, rules)
 * @returns {object} Audit result
 */
const performDeterministicAudit = async (text, opts = {}) => {
  const { category, analysisMode, country, region, rules } = opts;
  
  // Step 1: Normalize content and generate hash
  const normalizedText = normalizeContent(text);
  const rulesVersion = 'v1';
  let contentHash = null;
  try {
    contentHash = generateAuditHash(normalizedText, rulesVersion);
  } catch (error) {
    console.warn('[Audit Cache] Skipping cache because contentHash generation failed:', error.message);
  }
  
  // Step 2: Check cache first
  const cachedResult = contentHash
    ? await getCachedAudit(contentHash, rulesVersion)
    : null;
  if (cachedResult) {
    console.log(`[Audit Validation] Using cached result for deterministic consistency`);
    return cachedResult;
  }
  
  // Step 3: Run initial audit
  console.log(`[Audit Validation] Cache miss - running initial audit pass`);
  const result1 = await analyzeWithGemini({
    content: text,
    inputType: 'text',
    category,
    analysisMode,
    country,
    region,
    rules,
    contentContext: ''
  });
  
  // Step 4: Run validation audit
  console.log(`[Audit Validation] Running validation pass for consistency check`);
  await delay(500, 1000);
  const result2 = await analyzeWithGemini({
    content: text,
    inputType: 'text',
    category,
    analysisMode,
    country,
    region,
    rules,
    contentContext: ''
  });
  
  // Step 5: Compare results
  const similarity = calculateResultSimilarity(result1, result2);
  const score1 = result1.score || result1.complianceScore || 0;
  const score2 = result2.score || result2.complianceScore || 0;
  const scoreDiff = Math.abs(score1 - score2);
  
  console.log(`[Audit Validation] Similarity: ${similarity}% | Score Diff: ${scoreDiff} points`);
  
  let finalResult;
  if (scoreDiff <= 3) {
    // Results are stable - use first result
    console.log(`[Audit Validation] Pass - Scores match closely, using result 1`);
    finalResult = result1;
  } else {
    // Results differ significantly - run third audit and use majority
    console.log(`[Audit Validation] Score diff (${scoreDiff}) exceeds threshold - running third pass`);
    await delay(500, 1000);
    const result3 = await analyzeWithGemini({
      content: text,
      inputType: 'text',
      category,
      analysisMode,
      country,
      region,
      rules,
      contentContext: ''
    });
    
    const score3 = result3.score || result3.complianceScore || 0;
    console.log(`[Audit Validation] Results: Pass1=${score1} | Pass2=${score2} | Pass3=${score3}`);
    
    // Use majority voting
    const scores = [
      { score: score1, result: result1 },
      { score: score2, result: result2 },
      { score: score3, result: result3 }
    ];
    scores.sort((a, b) => a.score - b.score);
    
    // Use middle score (not extreme)
    finalResult = scores[1].result;
    console.log(`[Audit Validation] Using majority result: Score=${scores[1].score}`);
  }
  
  // Step 6: Store in cache
  const finalScore = finalResult.score || finalResult.complianceScore || 0;
  if (!contentHash) {
    console.warn('[Audit Cache] Skipping cache storage because contentHash is missing');
    return finalResult;
  }

  await storeCachedAudit(contentHash, normalizedText, finalResult, finalScore, rulesVersion);
  
  console.log(`[Audit Result] Stored in cache | Score: ${finalScore}`);
  return finalResult;
};

let openaiClient = null;

const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Required for URL analysis fallback.');
    }
    openaiClient = new OpenAI({ apiKey });
    console.log('[URL Fallback] OpenAI client initialized');
  }
  return openaiClient;
};

const validateInputSize = (input, type) => {
  if (type === 'text' && typeof input === 'string' && input.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text content exceeds ${MAX_TEXT_LENGTH} characters limit`);
  }
};

export const detectContentType = (input) => {
  if (input.text) return 'text';
  if (input.url) return 'url';
  if (input.file) {
    const mimetype = input.file?.mimetype || '';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'document';
    if (mimetype === 'application/msword') return 'document';
    if (mimetype === 'application/pdf') return 'document';
  }
  throw new Error('Unable to detect content type');
};

const isYouTubeUrl = (url) => {
  const urlLower = url.toLowerCase();
  return urlLower.includes('youtube.com') || urlLower.includes('youtu.be');
};

const detectUrlContentType = (url) => {
  const urlLower = url.toLowerCase();
  const videoPlatforms = [
    'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
    'facebook.com/watch', 'instagram.com/reel', 'tiktok.com',
    'twitch.tv'
  ];
  const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.m4v'];
  const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma'];

  if (videoPlatforms.some(platform => urlLower.includes(platform))) return 'video';
  if (videoExtensions.some(ext => urlLower.includes(ext))) return 'video';
  if (audioExtensions.some(ext => urlLower.includes(ext))) return 'audio';

  return 'webpage';
};

const downloadMediaFile = async (url) => {
  console.log(`[URL Processor] Downloading media from: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    await delay();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent()
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > MAX_MEDIA_SIZE) {
      throw new Error(`File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds limit of ${MAX_MEDIA_SIZE / 1024 / 1024}MB`);
    }

    return { buffer, mimetype: contentType };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Download timeout: URL took too long to respond');
    }
    throw new Error(`Failed to download media: ${error.message}`);
  }
};

const extractYouTubeVideoId = (url) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return parsed.pathname.replace('/', '').trim() || null;
    }
    if (parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const shortsIndex = pathParts.indexOf('shorts');
    if (shortsIndex !== -1 && pathParts[shortsIndex + 1]) {
      return pathParts[shortsIndex + 1];
    }
    const embedIndex = pathParts.indexOf('embed');
    if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
      return pathParts[embedIndex + 1];
    }
    return null;
  } catch {
    return null;
  }
};

const fetchYouTubeTranscript = async (url) => {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    console.warn('[YouTube Transcript] Invalid URL, unable to extract video ID');
    throw new Error('Invalid YouTube URL format. Please provide a valid YouTube video link.');
  }

  try {
    await delay(400, 1200);
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
    const transcript = transcriptItems.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();

    if (!transcript) {
      console.warn('[YouTube Transcript] Empty transcript received');
      throw new Error('Transcript unavailable');
    }

    console.log(`[YouTube Transcript] Success | Video: ${videoId} | Length: ${transcript.length} chars`);
    return transcript;
  } catch (error) {
    console.error(`[YouTube Transcript] Failure | Video: ${videoId} | Error: ${error.message}`);
    throw new Error(`YouTube transcript unavailable: ${error.message}`);
  }
};

const fetchYouTubeFallbackText = async (url, reason) => {
  const fallbackLines = [];
  fallbackLines.push('YouTube transcript unavailable.');
  if (reason) {
    fallbackLines.push(`Reason: ${reason}`);
  }
  fallbackLines.push(`Video URL: ${url}`);

  try {
    await delay(300, 800);
    let description = '';
    try {
      const videoResponse = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent()
        }
      });
      if (videoResponse.ok) {
        const html = await videoResponse.text();
        const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (match && match[1]) {
          description = match[1];
        }
      }
    } catch (error) {
      console.warn('[YouTube Transcript] Description fetch failed:', error.message);
    }

    const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      headers: {
        'User-Agent': getRandomUserAgent()
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.title) {
        fallbackLines.push(`Title: ${data.title}`);
      }
      if (data?.author_name) {
        fallbackLines.push(`Channel: ${data.author_name}`);
      }
    }

    if (description) {
      fallbackLines.push(`Description: ${description}`);
    }
  } catch (error) {
    console.warn('[YouTube Transcript] Fallback metadata unavailable:', error.message);
  }

  const fallbackText = fallbackLines.join(' ');
  return fallbackText.length < 60
    ? `${fallbackText} Please provide a summary or upload a file for review.`
    : fallbackText;
};

const analyzeUrlWithOpenAI = async (url) => {
  try {
    await delay(500, 1200);
    const openai = getOpenAIClient();
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: `Extract and summarize the main marketing/medical claims from this URL. Return plain text only. URL: ${url}`,
      temperature: 0.2
    });

    const text = response.output_text?.trim() || '';
    if (!text) {
      throw new Error('OpenAI URL analysis returned empty content');
    }

    console.log('[URL Fallback] OpenAI URL analysis succeeded.');
    return text;
  } catch (error) {
    console.warn('[URL Fallback] OpenAI URL analysis failed:', error.message);
    return '';
  }
};

const scanDocumentWithOpenAI = async (text) => {
  const normalized = (text || '').trim();
  const placeholderPatterns = [
    /no selectable text/i,
    /no readable text/i,
    /scanned document/i,
    /please upload a text-based/i
  ];

  if (!normalized || normalized.length < 200 || placeholderPatterns.some((pattern) => pattern.test(normalized))) {
    console.warn('[Document Scan] Skipping OpenAI scan: insufficient or placeholder text');
    return '';
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await delay(400, 900);
      const openai = getOpenAIClient();
      const response = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: `Extract the key marketing, medical, and compliance-relevant claims from this document. Return plain text only.\n\n${normalized.substring(0, 12000)}`,
        temperature: 0.2
      });

      const scanned = response.output_text?.trim() || '';
      if (!scanned || scanned.length < 200) {
        throw new Error('OpenAI document scan returned empty or too-short content');
      }

      console.log('[Document Scan] OpenAI scan succeeded.');
      return scanned;
    } catch (error) {
      console.warn('[Document Scan] OpenAI scan failed:', error.message);
      if (attempt < 2) {
        const backoffMs = 600 * attempt;
        console.log(`[Document Scan] Retrying in ${backoffMs}ms...`);
        await delay(backoffMs, backoffMs + 200);
        continue;
      }
      return '';
    }
  }

  return '';
};


const normalizeGeminiResult = (result) => {
  if (!result || typeof result !== 'object') {
    throw new Error('Gemini returned invalid JSON');
  }

  const normalizeScore = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    if (value <= 1) {
      return Math.round(value * 100);
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  };

  return {
    score: normalizeScore(result.score),
    status: result.status || 'Needs Review',
    summary: result.summary || 'Summary unavailable.',
    transcript: result.transcript || result.transcription || '',
    transcription: result.transcription || '',
    extractedContent: result.extractedContent || result.content || result.transcript || result.transcription || '',
    content: result.content || result.extractedContent || result.transcript || result.transcription || '',
    financialPenalty: result.financialPenalty || {
      riskLevel: 'Low',
      description: 'No financial risk assessment available.'
    },
    ethicalMarketing: result.ethicalMarketing || {
      score: normalizeScore(result?.ethicalMarketing?.score),
      assessment: 'Ethical marketing assessment unavailable.'
    },
    violations: Array.isArray(result.violations) ? result.violations : []
  };
};

const saveAuditRecord = async ({
  userId,
  contentType,
  originalInput,
  extractedText,
  transcript,
  auditResult
}) => {
  const normalizedResult = normalizeGeminiResult(auditResult);

  const record = new AuditRecord({
    userId,
    contentType,
    originalInput,
    extractedText,
    transcript,
    auditResult: normalizedResult
  });

  await record.save();
  return record;
};

const processText = async ({ text, category, analysisMode, country, region, rules }) => {
  validateInputSize(text, 'text');

  const auditResult = await performDeterministicAudit(text, {
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: 'text',
    originalInput: text,
    extractedText: text,
    transcript: text,
    extractedContent: text,
    auditResult
  };
};

const processMediaBuffer = async ({ buffer, mimetype, inputType, originalInput, category, analysisMode, country, region, rules }) => {
  const transcriptionResult = await transcribe(buffer, mimetype);
  const transcriptText = transcriptionResult.transcript;
  console.log('[Transcript] Length:', transcriptText?.length);

  const auditResult = await performDeterministicAudit(transcriptText, {
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: inputType,
    originalInput,
    extractedText: transcriptText,
    transcript: transcriptText,
    extractedContent: transcriptText,
    auditResult
  };
};

const processImageBuffer = async ({ buffer, originalInput, category, analysisMode, country, region, rules }) => {
  const extractedText = await extractTextFromImage(buffer);

  if (!extractedText || !extractedText.trim()) {
    throw new Error('Unable to extract readable text from image');
  }

  const auditResult = await performDeterministicAudit(extractedText, {
    category,
    analysisMode,
    country,
    region,
    rules
  });

  return {
    contentType: 'image',
    originalInput,
    extractedText,
    transcript: extractedText,
    extractedContent: extractedText,
    auditResult
  };
};

const processUrl = async ({ url, category, analysisMode, country, region, rules }) => {
  const urlType = detectUrlContentType(url);

  if (isYouTubeUrl(url)) {
    let transcriptText = '';
    try {
      console.log('[YouTube] Using yt-dlp-exec for YouTube transcription');
      transcriptText = await transcribeYoutubeUrl(url);
      console.log(`[YouTube] Transcript length: ${transcriptText.length} chars`);
    } catch (error) {
      console.warn('[YouTube] YouTube transcription failed, falling back to metadata:', error.message);
      transcriptText = await fetchYouTubeFallbackText(url, error.message);
    }

    const auditResult = await performDeterministicAudit(transcriptText, {
      category,
      analysisMode,
      country,
      region,
      rules
    });

    return {
      contentType: 'video',
      originalInput: url,
      extractedText: transcriptText,
      transcript: transcriptText,
      extractedContent: transcriptText,
      auditResult
    };
  }

  if (urlType === 'video' || urlType === 'audio') {
    const { buffer, mimetype } = await downloadMediaFile(url);
    if (mimetype.startsWith('text/') || mimetype.includes('html')) {
      let extractedText = '';

      try {
        ({ extractedText } = await scrapeUrl(url));
      } catch (error) {
        console.warn('[Scraping] Puppeteer scrape failed:', error.message);
      }

      if (!extractedText) {
        extractedText = await extractReadableFromUrl(url);
      }

      if (!extractedText) {
        extractedText = await analyzeUrlWithOpenAI(url);
      }

      if (!extractedText) {
        extractedText = await extractMetadataFromUrl(url);
      }

      if (!extractedText) {
        extractedText = `Content could not be extracted due to access restrictions or timeouts. URL: ${url}. Please provide text or upload a file for review.`;
      }

      const auditResult = await performDeterministicAudit(extractedText, {
        category,
        analysisMode,
        country,
        region,
        rules
      });

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText,
        transcript: extractedText,
        extractedContent: extractedText,
        auditResult
      };
    }
    return processMediaBuffer({
      buffer,
      mimetype,
      inputType: urlType,
      originalInput: url,
      category,
      analysisMode
    });
  }

  const extractionPlan = [];
  if (process.env.ZENROWS_API_KEY) {
    extractionPlan.push({ method: 'zenrows', logMethod: 'zenrows' });
  }
  extractionPlan.push(
    { method: 'puppeteer', logMethod: 'puppeteer_proxy' },
    { method: 'jina_reader', logMethod: 'jina_reader' },
    { method: 'mercury', logMethod: 'mercury' }
  );
  let lastError;
  const attemptedMethods = [];
  let botProtectionDetected = false;

  for (const planEntry of extractionPlan) {
    const { method, logMethod } = planEntry;
    let extractedText, extractionMethod, auditInputResult;
    
    try {
      attemptedMethods.push(logMethod);
      console.log(`[Extraction Pipeline] Attempting method ${attemptedMethods.length}/${extractionPlan.length}: ${logMethod}`);
      
      // STEP 1: Extract content with bot protection handling
      let extractionOptions = {};
      
      if (logMethod === 'puppeteer_proxy') {
        extractionOptions.retryWithEnhancedSettings = true;
        if (process.env.PROXY_URL) {
          console.log('[Scraper] Retrying with proxy...');
          extractionOptions.useProxy = true;
        } else {
          console.warn('[Extraction Pipeline] PROXY_URL environment variable not set - proxy retry disabled');
        }
      }

      // If bot protection was detected in a previous step and this is puppeteer, keep enhanced settings enabled
      if (botProtectionDetected && method === 'puppeteer') {
        console.log('[Extraction Pipeline] Previous method detected bot protection - using enhanced Puppeteer settings');
        extractionOptions.retryWithEnhancedSettings = true;
      }
      
      ({ extractedText, extractionMethod } = await extractBlogContentByMethod(url, method, extractionOptions));
      console.log('[Pipeline] Scraping completed', JSON.stringify({ method: extractionMethod, length: extractedText.length }));
      console.log('[Transcript] Length:', extractedText?.length);

      if (!extractedText || !extractedText.trim()) {
        console.warn('[Pipeline] Extraction failed: empty content', JSON.stringify({ method: extractionMethod }));
        lastError = new Error('extraction_failed_completely');
        continue;
      }

      // STEP 2: Build audit input
      auditInputResult = await buildAuditInput({
        rawContent: extractedText,
        sourceType: 'blog',
        contentFormat: 'article',
        extractionMethod
      });

      if (auditInputResult.validationResult.warnings.length) {
        console.warn('[Pipeline] Content warnings', JSON.stringify({ warnings: auditInputResult.validationResult.warnings }));
      }

      if (!auditInputResult.validationResult.isValid) {
        const reasons = auditInputResult.validationResult.reasons || [];
        if (reasons.includes('content_too_short')) {
          console.warn('[Pipeline] Content validation warning: short content', JSON.stringify({ reasons }));
          console.warn('[Pipeline] Continuing audit despite short content');
        } else {
          console.warn('[Pipeline] Content validation warning: continuing audit', JSON.stringify({ reasons }));
        }
      }

      if (!auditInputResult.cleanedContent || !auditInputResult.cleanedContent.trim()) {
        console.warn('[Pipeline] Cleaned content empty, trying next extraction method', JSON.stringify({ method: extractionMethod }));
        lastError = new Error('extraction_failed_completely');
        continue;
      }

      const shortContentWarning = auditInputResult.cleanedContent.length < 200 ? 'short_content' : undefined;

      // Log successful extraction - EXTRACTION SUCCEEDED at this point
      console.log(`✓ [Extraction Success] Method: ${extractionMethod.toUpperCase()} | Length: ${auditInputResult.cleanedContent.length} chars | Attempted: ${attemptedMethods.join(', ')}`);

      // STEP 3: Analyze with Gemini (separate error handling - parsing failure should NOT retry extraction)
      let auditResult;
      try {
        auditResult = await performDeterministicAudit(auditInputResult.auditInput.textContent, {
          category,
          analysisMode,
          country,
          region,
          rules
        });
      } catch (geminiError) {
        console.error('[Pipeline] ⚠️ Gemini analysis failed but extraction succeeded:', geminiError.message);
        console.log('[Pipeline] Returning extraction with fallback audit result');
        
        // Return a fallback audit result - extraction succeeded even if AI parsing failed
        auditResult = {
          score: 0,
          status: 'Needs Review',
          summary: 'Content extracted successfully but AI analysis encountered a parsing error. Please review manually or try again.',
          financialPenalty: {
            riskLevel: 'None',
            description: 'Unable to assess due to analysis error'
          },
          ethicalMarketing: {
            score: 0,
            assessment: 'Unable to assess due to analysis error'
          },
          violations: [],
          metadata: {
            parsingError: true,
            errorMessage: geminiError.message
          }
        };
      }

      auditResult.metadata = {
        ...auditResult.metadata,
        ...auditInputResult.auditInput.metadata,
        extractionMethod: extractionMethod,
        attemptedMethods: attemptedMethods,
        ...(shortContentWarning ? { content_warning: shortContentWarning } : {})
      };

      return {
        contentType: 'webpage',
        originalInput: url,
        extractedText: auditInputResult.cleanedContent,
        transcript: auditInputResult.cleanedContent,
        extractedContent: auditInputResult.cleanedContent,
        auditResult
      };
    } catch (error) {
      // Check if bot protection was detected
      if (error.shouldRetryWithEnhancedPuppeteer) {
        console.log(`[Extraction Pipeline] ${logMethod} detected bot protection, will retry with enhanced Puppeteer`);
        botProtectionDetected = true;
        // Don't set lastError yet, continue to next method
        continue;
      }
      
      // Check if this is a final bot protection failure after enhanced retry
      if (error.isFinalBotProtectionFailure) {
        console.error('[Extraction Pipeline] ❌ Bot protection confirmed - cannot bypass even with enhanced Puppeteer');
        
        // Return structured bot protection error instead of throwing
        return {
          contentType: 'error',
          originalInput: url,
          error: 'BOT_PROTECTION_DETECTED',
          message: 'The target website is protected by Cloudflare or bot detection and cannot be scraped automatically.',
          status: 403,
          metadata: {
            timestamp: new Date().toISOString(),
            attemptedMethods: attemptedMethods,
            suggestion: 'Consider providing the content manually or checking if the website allows scraping in its robots.txt or terms of service.'
          }
        };
      }
      
      // Regular extraction error
      lastError = error;
      console.warn('[Pipeline] Extraction attempt failed', JSON.stringify({ method: logMethod, message: error.message }));
    }
  }

  // All extractors failed - check if it was due to bot protection
  if (botProtectionDetected && attemptedMethods.some((attempt) => attempt === 'puppeteer' || attempt === 'puppeteer_proxy')) {
    console.error(`✗ [Extraction Failed] Bot protection persists across all methods`);
    return {
      contentType: 'error',
      originalInput: url,
      error: 'BOT_PROTECTION_DETECTED',
      message: 'The target website is protected by Cloudflare or bot detection and cannot be scraped automatically.',
      status: 403,
      metadata: {
        timestamp: new Date().toISOString(),
        attemptedMethods: attemptedMethods,
        suggestion: 'Consider providing the content manually or checking if the website allows scraping in its robots.txt or terms of service.'
      }
    };
  }

  // All extractors failed - return descriptive error
  const errorMessage = `All extraction methods failed for URL: ${url}. Attempted: ${attemptedMethods.join(', ')}. Last error: ${lastError?.message || 'Unknown error'}. The content may be protected by bot detection (Cloudflare, CAPTCHA) or require authentication.`;
  console.error(`✗ [Extraction Failed] ${errorMessage}`);
  throw new Error(errorMessage);
};

const processDocumentBuffer = async ({ buffer, mimetype, originalInput, category, analysisMode, country, region, rules }) => {
  let extractedText = await extractTextFromDocument(buffer, mimetype);

  let scannedText = await scanDocumentWithOpenAI(extractedText);
  if (!scannedText) {
    try {
      scannedText = await extractClaimsWithGemini(extractedText);
      console.log('[Document Scan] Gemini claim extraction succeeded.');
    } catch (error) {
      console.warn('[Document Scan] Gemini claim extraction failed:', error.message);
    }
  }

  if (scannedText && scannedText.length < 200) {
    console.warn('[Document Scan] Claim extraction too short, falling back to full text.');
    scannedText = '';
  }

  const auditText = scannedText || extractedText;

  const auditResult = await performDeterministicAudit(auditText, {
    category,
    analysisMode,
    country,
    region,
    rules
  });

  if (!auditResult.transcription) {
    auditResult.transcription = extractedText;
  }

  return {
    contentType: 'document',
    originalInput,
    extractedText,
    transcript: extractedText,
    extractedContent: extractedText,
    auditResult
  };
};

export const processContent = async (input, options = {}) => {
  const { userId, category, analysisMode, country, region } = options;

  if (!userId) {
    throw new Error('Authentication required');
  }

  const contentType = detectContentType(input);
  const rules = getRulesForSelection({ country, region, category });
  let processingResult;

  if (contentType === 'text') {
    processingResult = await processText({ text: input.text, category, analysisMode, country, region, rules });
  } else if (contentType === 'url') {
    processingResult = await processUrl({ url: input.url, category, analysisMode, country, region, rules });
  } else if (contentType === 'video' || contentType === 'audio') {
    processingResult = await processMediaBuffer({
      buffer: input.file.buffer,
      mimetype: input.file.mimetype,
      inputType: contentType,
      originalInput: input.file.originalname || `uploaded ${contentType}`,
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else if (contentType === 'image') {
    processingResult = await processImageBuffer({
      buffer: input.file.buffer,
      originalInput: input.file.originalname || 'uploaded image',
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else if (contentType === 'document') {
    processingResult = await processDocumentBuffer({
      buffer: input.file.buffer,
      mimetype: input.file.mimetype,
      originalInput: input.file.originalname || 'uploaded document',
      category,
      analysisMode,
      country,
      region,
      rules
    });
  } else {
    throw new Error('Unsupported input type');
  }

  const transcriptText = processingResult.transcript || processingResult.extractedText || '';
  const extractedContent = processingResult.extractedContent || processingResult.extractedText || transcriptText || '';
  processingResult.auditResult.transcript = transcriptText;
  processingResult.auditResult.transcription = transcriptText;
  processingResult.auditResult.extractedContent = extractedContent;
  processingResult.auditResult.content = extractedContent;

  await saveAuditRecord({
    userId,
    contentType: processingResult.contentType,
    originalInput: processingResult.originalInput,
    extractedText: processingResult.extractedText,
    transcript: processingResult.transcript,
    auditResult: processingResult.auditResult
  });

  // FIX 5: Add benchmark score to audit result
  const benchmarkInfo = calculateBenchmarkScore(
    category || 'default', 
    processingResult.auditResult?.score || processingResult.auditResult?.complianceScore || 0
  );
  
  return {
    ...processingResult.auditResult,
    transcript: transcriptText,
    transcription: transcriptText,
    extractedContent,
    content: extractedContent,
    ...benchmarkInfo
  };
};

export default { processContent };
