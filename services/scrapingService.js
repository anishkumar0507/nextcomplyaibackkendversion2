import chromium from '@sparticuz/chromium';
import fs from 'fs';
import { Readability } from '@mozilla/readability';
import Mercury from '@postlight/mercury-parser';
import { JSDOM } from 'jsdom';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';

puppeteerExtra.use(StealthPlugin());
const puppeteer = puppeteerExtra.addExtra(puppeteerCore);

/**
 * Web Scraping Service
 * Extracts visible marketing claims from web pages
 */

const MAX_CONTENT_LENGTH = 50000; // Limit scraped content to 50KB
const MIN_CONTENT_CHARS = 800;
const MIN_CONTENT_WORDS = 120;
const REQUEST_TIMEOUT = 60000; // 60 seconds
const MAX_ATTEMPTS = 3;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];
const BOT_BLOCK_PATTERNS = [/captcha/i, /cloudflare/i, /access denied/i, /attention required/i, /verify you are human/i];

// Bot protection detection patterns
const BOT_PROTECTION_PHRASES = [
  'verify you are not a bot',
  'security verification',
  'protect against malicious bots',
  'cloudflare',
  'checking your browser',
  'just a moment',
  'please verify you are a human',
  'enable javascript and cookies',
  'ddos protection',
  'are you a robot',
  'access denied',
  'why have i been blocked',
  'this request has been blocked'
];

const MIN_VALID_CONTENT_LENGTH = 500; // Minimum characters for valid content

const delay = (minMs = 400, maxMs = 1200) => {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, jitter));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Detect if extracted content is a bot protection page
 * @param {string} content - Extracted text content
 * @returns {boolean} True if bot protection detected
 */
const isBotProtectionPage = (content) => {
  if (!content || typeof content !== 'string') return false;
  
  const lowerContent = content.toLowerCase();
  const matchedPhrases = BOT_PROTECTION_PHRASES.filter(phrase => 
    lowerContent.includes(phrase.toLowerCase())
  );
  
  if (matchedPhrases.length > 0) {
    console.log('[Extraction] Bot protection detected. Matched phrases:', matchedPhrases);
    return true;
  }
  
  return false;
};

/**
 * Validate extracted content length
 * @param {string} content - Extracted text content
 * @returns {boolean} True if content meets minimum length requirement
 */
const isContentLengthValid = (content) => {
  if (!content || typeof content !== 'string') return false;
  
  const cleanedContent = content.trim();
  const isValid = cleanedContent.length >= MIN_VALID_CONTENT_LENGTH;
  
  if (!isValid) {
    console.log(`[Extraction] Content too short: ${cleanedContent.length} chars (minimum: ${MIN_VALID_CONTENT_LENGTH})`);
  }
  
  return isValid;
};

const getRandomUserAgent = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

/**
 * Sanitize scraped content
 * @param {string} text - Raw text content
 * @returns {string} Sanitized text
 */
const sanitizeContent = (text) => {
  if (!text) return '';
  
  // Remove excessive whitespace
  let sanitized = text.replace(/\s+/g, ' ').trim();
  
  // Limit length
  if (sanitized.length > MAX_CONTENT_LENGTH) {
    sanitized = sanitized.substring(0, MAX_CONTENT_LENGTH) + '...';
  }
  
  return sanitized;
};

const normalizeWhitespace = (text) => {
  if (!text) return '';
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const isExecutableFile = (candidatePath) => {
  if (!candidatePath) return false;
  try {
    const stat = fs.statSync(candidatePath);
    return stat.isFile();
  } catch {
    return false;
  }
};

const isBotBlocked = (text) => BOT_BLOCK_PATTERNS.some((pattern) => pattern.test(text));

const logStructured = (event, details = {}) => {
  console.log('[Scraping]', JSON.stringify({ event, ...details }));
};

const getLineStats = (text) => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const wordCounts = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
  return { lines, wordCounts };
};

const isHeadingHeavy = (text) => {
  const { lines, wordCounts } = getLineStats(text);
  if (!lines.length) return true;
  const headingLike = lines.filter((line, index) => {
    const words = wordCounts[index] || 0;
    const isShort = words <= 6;
    const isUpper = line.length >= 6 && line === line.toUpperCase();
    const hasMarker = line.startsWith('#') || line.endsWith(':');
    return isShort || isUpper || hasMarker;
  });
  return headingLike.length / lines.length >= 0.7;
};

const isContentTooShort = (text) => {
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean).length;
  return text.length < MIN_CONTENT_CHARS || words < MIN_CONTENT_WORDS || isHeadingHeavy(text);
};

const cleanExtractedText = (text) => {
  if (!text) return '';
  const navTerms = [
    'home',
    'about',
    'contact',
    'privacy',
    'terms',
    'cookie',
    'subscribe',
    'newsletter',
    'sign in',
    'sign up',
    'login',
    'register',
    'follow',
    'share',
    'advert',
    'sponsored',
    'related posts',
    'comments'
  ];

  const seen = new Set();
  const cleanedLines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => {
      const normalized = line.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      if (line.length < 40 && navTerms.some((term) => normalized.includes(term))) {
        return false;
      }
      if (line.length < 25 && normalized.match(/\b(menu|navigation|sidebar|footer|header)\b/)) {
        return false;
      }
      return true;
    });

  return sanitizeContent(cleanedLines.join('\n'));
};

const extractReadableText = (html) => {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' });
    const article = new Readability(dom.window.document).parse();
    if (article?.textContent) {
      return cleanExtractedText(article.textContent);
    }
  } catch (error) {
    console.warn('[Scraping] Readability parse failed:', error.message);
  }
  return '';
};

const extractFromHtmlContainers = (html) => {
  try {
    const dom = new JSDOM(html, { url: 'https://example.com' });
    const document = dom.window.document;
    const selectors = [
      'article',
      '.blog-content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.content',
      '.main-content'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent) {
        return cleanExtractedText(element.textContent);
      }
    }
  } catch (error) {
    console.warn('[Scraping] Container extraction failed:', error.message);
  }
  return '';
};

const extractMetadataText = (metadata) => {
  const parts = [];
  if (metadata?.title) parts.push(`Title: ${metadata.title}`);
  if (metadata?.description) parts.push(`Description: ${metadata.description}`);
  if (metadata?.ogTitle) parts.push(`OG Title: ${metadata.ogTitle}`);
  if (metadata?.ogDescription) parts.push(`OG Description: ${metadata.ogDescription}`);
  return sanitizeContent(parts.join(' '));
};

const fetchJinaReaderText = async (url) => {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/plain'
    }
  });

  if (!response.ok) {
    throw new Error(`Jina Reader HTTP ${response.status}`);
  }

  const text = await response.text();
  return cleanExtractedText(text);
};

const fetchJinaReaderRawText = async (url) => {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/plain'
    }
  });

  // Detect Cloudflare/bot protection at HTTP level
  if (response.status === 403) {
    console.warn('[Jina Reader] HTTP 403 Forbidden - Likely Cloudflare protection');
    const err = new Error(`Jina Reader returned HTTP 403 - Bot protection detected`);
    err.isBotProtection = true;
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Jina Reader HTTP ${response.status}`);
  }

  const text = await response.text();
  return normalizeWhitespace(text);
};

const fetchMercuryText = async (url) => {
  const result = await Mercury.parse(url, { fetchAllPages: false });
  const raw = result?.content || result?.excerpt || '';
  if (!raw) {
    return '';
  }
  const dom = new JSDOM(raw, { url });
  return cleanExtractedText(dom.window.document.body?.textContent || raw);
};

const fetchMercuryRawText = async (url) => {
  const result = await Mercury.parse(url, { fetchAllPages: false });
  const raw = result?.content || result?.excerpt || '';
  if (!raw) {
    return '';
  }
  const dom = new JSDOM(raw, { url });
  return normalizeWhitespace(dom.window.document.body?.textContent || raw);
};

const fetchPuppeteerArticleText = async (url, options = {}) => {
  const isRetryAfterBotProtection = options.isRetryAfterBotProtection || false;
  const waitUntilTimeout = options.waitUntilTimeout || REQUEST_TIMEOUT;
  const useProxy = options.useProxy || false;
  
  console.log('[Puppeteer + Stealth] Extracting article from:', url);
  if (isRetryAfterBotProtection) {
    console.log('[Puppeteer + Stealth] RETRYING with enhanced bot protection evasion settings');
  }
  if (useProxy && process.env.PROXY_URL) {
    console.log('[Scraper] Proxy enabled for Puppeteer:', process.env.PROXY_URL);
  }
  
  const { path: resolvedExecutablePath, isChromium } = await resolveExecutablePath();
  if (!resolvedExecutablePath) {
    throw new Error('No Chromium/Chrome executable found for Puppeteer. Set PUPPETEER_EXECUTABLE_PATH to chrome.exe or msedge.exe');
  }

  const userAgent = getRandomUserAgent();
  
  // Enhanced stealth arguments to evade Cloudflare and bot detection
  const stealthArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1366,768',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
    '--allow-running-insecure-content',
    '--disable-infobars',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--metrics-recording-only',
    '--disable-default-apps',
    '--no-zygote',
    '--disable-breakpad',
    '--user-agent=' + userAgent
  ];

  // Add proxy support if enabled and available
  if (useProxy && process.env.PROXY_URL) {
    stealthArgs.push(`--proxy-server=${process.env.PROXY_URL}`);
    console.log('[Scraper] Added proxy server to Puppeteer launch arguments');
  }

  const browser = await puppeteer.launch({
    args: isChromium ? chromium.args : stealthArgs,
    executablePath: resolvedExecutablePath || undefined,
    headless: isChromium ? chromium.headless : 'new',
    ignoreHTTPSErrors: true,
    defaultViewport: null
  });

  try {
    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent(userAgent);
    
    // Set realistic HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // Set realistic viewport with device scale factor
    await page.setViewport({ 
      width: 1366, 
      height: 768,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });
    
    // Additional stealth: override navigator properties that Cloudflare checks
    await page.evaluateOnNewDocument(() => {
      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      
      // Override the navigator.plugins property to appear like a real browser
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      
      // Override the navigator.languages property
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      
      // Add chrome object to window (common in real Chrome browsers)
      window.chrome = {
        runtime: {}
      };
      
      // Override permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    const navigationTimeout = isRetryAfterBotProtection ? 45000 : REQUEST_TIMEOUT;
    page.setDefaultNavigationTimeout(navigationTimeout);
    console.log('[Puppeteer + Stealth] Navigating with enhanced stealth mode...', `(timeout: ${navigationTimeout}ms)`);

    // Enhanced settings for bot protection retry
    let navigationOptions = { waitUntil: 'networkidle2', timeout: navigationTimeout };
    
    if (isRetryAfterBotProtection) {
      // Add extra delay before navigation to appear more human-like
      await sleep(2000);
      navigationOptions = { waitUntil: 'networkidle2', timeout: 45000 };
    }

    await page.goto(url, navigationOptions);
    await page.waitForSelector('body', { timeout: 15000 });
    
    // Wait for main content selectors with better timeout handling
    const contentSelectors = ['article', 'main', '[role="main"]', '.content', '.article-content', '.post-content'];
    let contentLoaded = false;
    
    for (const selector of contentSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        console.log(`[Puppeteer] Found content selector: ${selector}`);
        contentLoaded = true;
        break;
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (contentLoaded) {
      await sleep(1500); // Extra wait for dynamic content
    } else {
      await sleep(1200); // Fallback wait
    }

    // Get full page HTML after rendering
    const pageHtml = await page.content();

    // Try direct selector extraction first for better quality
    let extractedText = '';
    for (const selector of contentSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await page.evaluate(el => el.textContent, element);
          if (text && text.trim().length > MIN_VALID_CONTENT_LENGTH) {
            extractedText = normalizeWhitespace(text);
            console.log(`[Puppeteer] Extracted ${extractedText.length} chars from selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Fallback to Readability if direct extraction didn't work
    if (!extractedText || extractedText.trim().length < MIN_VALID_CONTENT_LENGTH) {
      console.log('[Puppeteer] Falling back to Readability parser');
      const dom = new JSDOM(pageHtml, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      extractedText = article?.textContent ?? '';
      extractedText = normalizeWhitespace(extractedText);
    }
    
    if (!extractedText.trim()) {
      throw new Error('Readability extracted empty content from page');
    }

    // Check if we extracted a bot protection page
    if (isBotProtectionPage(extractedText)) {
      const err = new Error('Puppeteer extracted bot protection page');
      err.isBotProtection = true;
      throw err;
    }

    return extractedText;
  } finally {
    await browser.close().catch(() => {});
  }
};

/**
 * Create a structured bot protection error response
 */
const createBotProtectionError = (message = 'Bot protection detected') => {
  return {
    error: 'BOT_PROTECTION_DETECTED',
    message: message || 'The target website is protected by Cloudflare or bot detection and cannot be scraped automatically.',
    status: 403,
    metadata: {
      timestamp: new Date().toISOString(),
      suggestion: 'Consider providing the content manually or checking if the website allows scraping.'
    }
  };
};

/**
 * Extract content using ZenRows API
 * Uses JavaScript rendering and premium proxy to bypass Cloudflare and bot protection
 * @param {string} url - URL to scrape
 * @returns {Promise<string>} Extracted text content
 */
const fetchZenRowsArticleText = async (url) => {
  const apiKey = process.env.ZENROWS_API_KEY;
  
  if (!apiKey) {
    throw new Error('ZENROWS_API_KEY environment variable not set');
  }

  console.log('[ZenRows] Attempting extraction with ZenRows API...');
  
  try {
    // ZenRows API with JavaScript rendering and premium proxy
    const zenRowsUrl = `https://api.zenrows.com/v1/?url=${encodeURIComponent(url)}&apikey=${apiKey}&js_render=true&premium_proxy=true`;
    
    const response = await fetch(zenRowsUrl, {
      headers: {
        'User-Agent': getRandomUserAgent()
      },
      timeout: REQUEST_TIMEOUT
    });

    if (!response.ok) {
      throw new Error(`ZenRows API returned HTTP ${response.status}`);
    }

    const html = await response.text();
    
    if (!html || html.trim().length === 0) {
      throw new Error('ZenRows returned empty HTML');
    }

    // Extract text from HTML
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    let extractedText = article?.textContent ?? '';
    extractedText = normalizeWhitespace(extractedText);

    if (!extractedText.trim()) {
      // Fallback to direct text content extraction
      extractedText = dom.window.document.body?.textContent || '';
      extractedText = normalizeWhitespace(extractedText);
    }

    if (!extractedText.trim()) {
      throw new Error('ZenRows: Could not extract text from HTML');
    }

    // Check if we extracted a bot protection page
    if (isBotProtectionPage(extractedText)) {
      throw new Error('ZenRows extracted bot protection page');
    }

    console.log(`[ZenRows] Successfully extracted ${extractedText.length} chars`);
    return extractedText;
  } catch (error) {
    console.error('[ZenRows] Extraction failed:', error.message);
    throw error;
  }
};

export const extractBlogContentByMethod = async (url, method, options = {}) => {
  if (method === 'jina_reader') {
    try {
      const text = await fetchJinaReaderRawText(url);
      if (!text.trim()) throw new Error('Jina Reader returned empty content');
      
      // Validate content is not bot protection page
      if (isBotProtectionPage(text)) {
        throw new Error('Jina Reader extracted bot protection page');
      }
      
      // Validate content length
      if (!isContentLengthValid(text)) {
        throw new Error(`Jina Reader content too short: ${text.trim().length} chars`);
      }
      
      console.log(`[Jina Reader] Successfully extracted ${text.length} chars`);
      return { extractedText: text, extractionMethod: method };
    } catch (error) {
      // If Jina Reader hit bot protection, signal for enhanced Puppeteer retry
      if (error.isBotProtection) {
        console.log('[Jina Reader] Bot protection detected - will trigger enhanced Puppeteer retry');
        error.shouldRetryWithEnhancedPuppeteer = true;
      }
      throw error;
    }
  }

  if (method === 'mercury') {
    try {
      const text = await fetchMercuryRawText(url);
      if (!text.trim()) throw new Error('Mercury Parser returned empty content');
      
      // Validate content is not bot protection page
      if (isBotProtectionPage(text)) {
        throw new Error('Mercury Parser extracted bot protection page');
      }
      
      // Validate content length
      if (!isContentLengthValid(text)) {
        throw new Error(`Mercury Parser content too short: ${text.trim().length} chars`);
      }
      
      console.log(`[Mercury Parser] Successfully extracted ${text.length} chars`);
      return { extractedText: text, extractionMethod: method };
    } catch (error) {
      // If Mercury hit bot protection, signal for enhanced Puppeteer retry
      if (error.isBotProtection) {
        console.log('[Mercury Parser] Bot protection detected - will trigger enhanced Puppeteer retry');
        error.shouldRetryWithEnhancedPuppeteer = true;
      }
      throw error;
    }
  }

  if (method === 'puppeteer') {
    try {
      // Check if this is a retry after bot protection was detected
      const retryWithEnhancedSettings = options.retryWithEnhancedSettings || false;
      const useProxy = options.useProxy || false;
      
      const text = await fetchPuppeteerArticleText(url, { 
        isRetryAfterBotProtection: retryWithEnhancedSettings,
        useProxy: useProxy
      });
      
      if (!text.trim()) throw new Error('Puppeteer returned empty content');
      
      // Validate content is not bot protection page
      if (isBotProtectionPage(text)) {
        const err = new Error('Puppeteer extracted bot protection page');
        err.isBotProtection = true;
        throw err;
      }
      
      // Validate content length
      if (!isContentLengthValid(text)) {
        throw new Error(`Puppeteer content too short: ${text.trim().length} chars`);
      }
      
      console.log(`[Puppeteer + Readability] Successfully extracted ${text.length} chars`);
      return { extractedText: text, extractionMethod: method };
    } catch (error) {
      // If this was already a retry and still failed, mark as final bot protection failure
      if (options.retryWithEnhancedSettings && error.isBotProtection) {
        console.error('[Puppeteer] Bot protection persists even after enhanced retry');
        error.isFinalBotProtectionFailure = true;
      }
      throw error;
    }
  }

  if (method === 'zenrows') {
    try {
      console.log('[Scraper] ZenRows fallback triggered');
      const text = await fetchZenRowsArticleText(url);
      
      if (!text.trim()) throw new Error('ZenRows returned empty content');
      
      // Validate content is not bot protection page
      if (isBotProtectionPage(text)) {
        throw new Error('ZenRows extracted bot protection page');
      }
      
      // Validate content length
      if (!isContentLengthValid(text)) {
        throw new Error(`ZenRows content too short: ${text.trim().length} chars`);
      }
      
      console.log(`[Scraper] ZenRows extraction successful | Length: ${text.length} chars`);
      return { extractedText: text, extractionMethod: method };
    } catch (error) {
      console.error('[ZenRows] Final attempt failed:', error.message);
      throw error;
    }
  }

  throw new Error(`Unsupported extraction method: ${method}`);
};

const resolveExecutablePath = async () => {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && isExecutableFile(envPath)) {
    return { path: envPath, isChromium: false };
  }

  if (process.platform === 'win32') {
    const windowsCandidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const candidate of windowsCandidates) {
      if (isExecutableFile(candidate)) {
        return { path: candidate, isChromium: false };
      }
    }

    // @sparticuz/chromium is not supported on Windows in most environments.
    return { path: null, isChromium: false };
  }

  const chromiumPath = await chromium.executablePath();
  if (chromiumPath && isExecutableFile(chromiumPath)) {
    return { path: chromiumPath, isChromium: true };
  }

  return { path: null, isChromium: false };
};

const fetchHtml = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    await delay();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
};

export const extractReadableFromUrl = async (url) => {
  try {
    const html = await fetchHtml(url);
    const readableText = extractReadableText(html);
    if (!readableText.trim()) {
      throw new Error('Readability returned empty content');
    }
    console.log('[Scraping] Readability URL extraction succeeded.');
    return readableText;
  } catch (error) {
    console.warn('[Scraping] Readability URL extraction failed:', error.message);
    return '';
  }
};

export const extractMetadataFromUrl = async (url) => {
  try {
    const html = await fetchHtml(url);
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const metadata = {
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
    };
    const metadataText = extractMetadataText(metadata);
    if (!metadataText.trim()) {
      throw new Error('Metadata extraction returned empty content');
    }
    console.log('[Scraping] Metadata URL extraction succeeded.');
    return metadataText;
  } catch (error) {
    console.warn('[Scraping] Metadata URL extraction failed:', error.message);
    return '';
  }
};

/**
 * Scrape webpage and extract marketing content
 * @param {string} url - URL to scrape
 * @returns {Promise<{extractedText: string, url: string}>}
 */
export const scrapeUrl = async (url) => {
  // Validate URL
  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  let lastError;

  try {
    const jinaText = await fetchJinaReaderText(url);
    if (jinaText && !isContentTooShort(jinaText)) {
      logStructured('jina_reader', { status: 'success', length: jinaText.length });
      return { extractedText: jinaText, url };
    }
    if (jinaText) {
      logStructured('jina_reader', { status: 'short', length: jinaText.length });
    }
  } catch (error) {
    logStructured('jina_reader', { status: 'error', message: error.message });
  }

  try {
    const mercuryText = await fetchMercuryText(url);
    if (mercuryText && !isContentTooShort(mercuryText)) {
      logStructured('mercury_parser', { status: 'success', length: mercuryText.length });
      return { extractedText: mercuryText, url };
    }
    if (mercuryText) {
      logStructured('mercury_parser', { status: 'short', length: mercuryText.length });
    }
  } catch (error) {
    logStructured('mercury_parser', { status: 'error', message: error.message });
  }

  const { path: resolvedExecutablePath, isChromium } = await resolveExecutablePath();
  const canLaunchBrowser = !!resolvedExecutablePath;

  if (!canLaunchBrowser) {
    logStructured('browser_fallback', { status: 'unavailable' });
    const readable = await extractReadableFromUrl(url);
    if (readable) {
      return { extractedText: readable, url };
    }
    const metadata = await extractMetadataFromUrl(url);
    if (metadata) {
      return { extractedText: metadata, url };
    }
    throw new Error('Failed to scrape URL: no browser available for dynamic pages');
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const userAgent = getRandomUserAgent();
    let browser;

    try {
      await delay();
      logStructured('browser_attempt', { attempt, maxAttempts: MAX_ATTEMPTS, url });

      browser = await puppeteer.launch({
        args: isChromium ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: resolvedExecutablePath || undefined,
        headless: isChromium ? chromium.headless : 'new'
      });

      const page = await browser.newPage();
      await page.setUserAgent(userAgent);
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1'
      });
      await page.setViewport({ width: 1366, height: 768 });
      page.setDefaultNavigationTimeout(REQUEST_TIMEOUT);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
          request.abort();
          return;
        }
        request.continue();
      });

      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: REQUEST_TIMEOUT
      });

      if (!response) {
        throw new Error('No response received during navigation');
      }

      const status = response.status();
      if (status === 403) {
        console.warn('[Scraping] Bot protection detected (HTTP 403). Triggering fallback.');
        const html = await page.content();
        const readableText = extractReadableText(html);
        if (readableText) {
          console.log('[Scraping] Readability fallback succeeded after 403.');
          return { extractedText: readableText, url };
        }
        const metadata = await page.evaluate(() => ({
          title: document.title || '',
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
          ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
        }));
        const metadataText = extractMetadataText(metadata);
        if (metadataText) {
          console.warn('[Scraping] Returning metadata fallback after 403.');
          return { extractedText: metadataText, url };
        }
        return { extractedText: sanitizeContent(`Access restricted. URL: ${url}`), url };
      }

      await page.waitForSelector('body', { timeout: 15000 });
      await sleep(1500);

      const rawText = await page.evaluate(() => {
        const selectorsToRemove = [
          'script',
          'style',
          'noscript',
          'nav',
          'header',
          'footer',
          'aside',
          '.sidebar',
          '.nav',
          '.menu',
          '.advert',
          '.ad',
          '.ads',
          '.sponsored',
          '.newsletter',
          '.cookie',
          '.banner'
        ];
        document.querySelectorAll(selectorsToRemove.join(',')).forEach((el) => el.remove());

        const containers = [
          'article',
          '.blog-content',
          '.post-content',
          '.entry-content',
          '.article-content',
          '.content',
          '.main-content'
        ];
        for (const selector of containers) {
          const element = document.querySelector(selector);
          if (element?.innerText) {
            return element.innerText;
          }
        }

        return document.body ? document.body.innerText : '';
      });

      const extractedText = cleanExtractedText(rawText);

      if (!extractedText.trim()) {
        const html = await page.content();
        const readableText = extractReadableText(html) || extractFromHtmlContainers(html);
        if (readableText) {
          logStructured('readability_fallback', { status: 'success', length: readableText.length });
          return { extractedText: readableText, url };
        }
        const metadata = await page.evaluate(() => ({
          title: document.title || '',
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
          ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute('content') || ''
        }));
        const metadataText = extractMetadataText(metadata);
        if (metadataText) {
          console.warn('[Scraping] Returning metadata fallback after empty body text.');
          return { extractedText: metadataText, url };
        }
      }

      if (!extractedText.trim()) {
        console.warn('[Scraping] Empty content response detected.');
        throw new Error('Empty content response');
      }

      if (isBotBlocked(extractedText)) {
        console.warn('[Scraping] CAPTCHA or bot protection content detected.');
        throw new Error('CAPTCHA or bot protection detected');
      }

      logStructured('browser_extract', { status: 'success', length: extractedText.length });

      return {
        extractedText,
        url
      };
    } catch (error) {
      lastError = error;
      console.error(`[Scraping] Attempt ${attempt} failed: ${error.message}`);

      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = Math.min(15000, 1000 * (2 ** (attempt - 1)));
        console.log(`[Scraping] Retrying with new user-agent after ${backoffMs}ms...`);
        await delay(backoffMs, backoffMs + 500);
        continue;
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  throw new Error(`Failed to scrape URL: ${lastError?.message || 'Unknown error'}`);
};

export default { scrapeUrl };
