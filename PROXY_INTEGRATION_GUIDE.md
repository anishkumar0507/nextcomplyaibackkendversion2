# Proxy Integration for Cloudflare Bot Protection Bypass

## Overview

This document describes the implementation of proxy support for the NMC3 extraction pipeline to bypass Cloudflare and other bot protection mechanisms. The system intelligently detects when bot protection blocks content extraction and automatically retries using Puppeteer with proxy support.

## Architecture

### Extraction Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        URL Input                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼─────────┐
                    │ Jina Reader    │
                    │ (HTTP API)     │
                    └──────┬──────────┘
                           │
                   ┌───────▼────────────┐
                   │ Success? Return    │
                   │ Content            │
                   └───────┬────────────┘
                           │ No
                ┌──────────▼────────────┐
                │ Bot Protection       │
                │ Detected?            │
                │ (HTTP 403, phrases)  │
                └──────────┬────────────┘
                           │ Yes
                ┌──────────▼────────────┐
         ┌──────│ Set Flag:             │
         │      │ botProtectionDetected │
         │      │ = true                │
         │      └───────────────────────┘
         │
         ├────────────────────────────────┐
         │                                │
    ┌────▼──────────┐          ┌──────────▼──────┐
    │ Mercury Parser│          │ Puppeteer       │
    │ (Fallback 1)  │          │ Standard Mode   │
    └────┬──────────┘          │ (Fallback 2)    │
         │                     └──────┬──────────┘
         │ Content OK?               │ Still blocked?
         │                           │
         └─────────────┬─────────────┘
                       │ All failed
                       │
              ┌────────▼──────────┐
              │ botProtectionDet. │
              │ = true +          │
              │ method == 'pupp'  │
              └────────┬──────────┘
                       │ Yes
              ┌────────▼────────────────┐
              │ Puppeteer + Proxy       │
              │ - Enhanced Stealth      │
              │ - Proxy Server Enabled  │
              │ - 45s Timeout           │
              │ - 2s Human Delay        │
              └────────┬─────────────────┘
                       │
              ┌────────▼──────────────┐
              │ Success with Proxy?   │
              │ Return Content        │
              └────────┬──────────────┘
                       │ No
              ┌────────▼──────────────┐
              │ Return Error:         │
              │ BOT_PROTECTION_DET.   │
              │ HTTP 403              │
              └───────────────────────┘
```

## Implementation Details

### 1. Proxy Configuration

**Environment Variable:**
```bash
PROXY_URL=http://proxy-host:port
# or with authentication:
PROXY_URL=http://username:password@proxy-host:port
```

**Configuration File:**
Update `.env.example` with:
```dotenv
# Proxy URL for bypassing Cloudflare and bot protection (OPTIONAL)
# Format: http://proxy-host:port or https://proxy-host:port
# Used when retrying Puppeteer extractions after bot protection detection
PROXY_URL=http://proxy.example.com:8080
```

### 2. Modified Files

#### `services/scrapingService.js`

**Changes to `fetchPuppeteerArticleText()`:**

```javascript
const fetchPuppeteerArticleText = async (url, options = {}) => {
  const isRetryAfterBotProtection = options.isRetryAfterBotProtection || false;
  const waitUntilTimeout = options.waitUntilTimeout || REQUEST_TIMEOUT;
  const useProxy = options.useProxy || false;  // NEW

  // ... existing code ...

  // Add proxy support if enabled
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
  // ... rest of function ...
};
```

**Changes to `extractBlogContentByMethod()`:**

```javascript
if (method === 'puppeteer') {
  try {
    const retryWithEnhancedSettings = options.retryWithEnhancedSettings || false;
    const useProxy = options.useProxy || false;  // NEW
    
    const text = await fetchPuppeteerArticleText(url, { 
      isRetryAfterBotProtection: retryWithEnhancedSettings,
      useProxy: useProxy  // PASS PROXY OPTION
    });
    // ... rest of function ...
  }
}
```

#### `services/contentProcessor.js`

**Changes to `processUrl()` extraction loop:**

```javascript
for (const method of extractionPlan) {
  try {
    // ... existing code ...
    
    // If bot protection detected, enable proxy for Puppeteer
    if (botProtectionDetected && method === 'puppeteer') {
      console.log('[Extraction Pipeline] Previous method detected bot protection - using enhanced Puppeteer settings');
      extractionOptions.retryWithEnhancedSettings = true;
      
      // Enable proxy if configured
      if (process.env.PROXY_URL) {
        console.log('[Scraper] Retrying with proxy...');  // NEW LOG
        extractionOptions.useProxy = true;  // NEW
      } else {
        console.warn('[Extraction Pipeline] PROXY_URL environment variable not set - proxy retry disabled');
      }
    }
    
    ({ extractedText, extractionMethod } = await extractBlogContentByMethod(url, method, extractionOptions));
    // ... rest of function ...
  }
}
```

## Logging

### Log Messages Added

The implementation adds these specific log messages for monitoring and debugging:

#### Proxy Configuration Logging

```
[Scraper] Proxy enabled for Puppeteer: http://proxy-host:port
[Scraper] Added proxy server to Puppeteer launch arguments
[Scraper] Retrying with proxy...
```

#### Bot Protection Detection Logging

```
[Jina Reader] Bot protection detected - will trigger enhanced Puppeteer retry
[Mercury Parser] Bot protection detected - will trigger enhanced Puppeteer retry
[Extraction Pipeline] Previous method detected bot protection - using enhanced Puppeteer settings
```

#### Warning Logs

```
[Extraction Pipeline] PROXY_URL environment variable not set - proxy retry disabled
```

## Bot Protection Detection

### Phrase Detection (13 Phrases)

The system detects bot protection pages by checking for these phrases:

```javascript
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
```

### HTTP Status Detection

- **HTTP 403 Forbidden**: Detected in `fetchJinaReaderRawText()`
- Sets `error.isBotProtection = true` flag
- Sets `error.shouldRetryWithEnhancedPuppeteer` flag

### Content Validation

- Checks for bot protection phrases in extracted text
- Minimum content length: 500 characters
- Validates content at each extraction step

## Error Handling

### Structured Error Response

When bot protection cannot be bypassed even with proxy:

```json
{
  "contentType": "error",
  "originalInput": "https://www.example.com",
  "error": "BOT_PROTECTION_DETECTED",
  "message": "The target website is protected by Cloudflare or bot detection and cannot be scraped automatically.",
  "status": 403,
  "metadata": {
    "timestamp": "2026-03-05T10:30:00.000Z",
    "attemptedMethods": ["jina_reader", "mercury", "puppeteer"],
    "suggestion": "Consider providing the content manually or checking if the website allows scraping in its robots.txt or terms of service."
  }
}
```

### HTTP Status Code

- **HTTP 201**: Successful extraction and audit
- **HTTP 403**: Final bot protection failure (cannot bypass)
- **HTTP 500**: Other extraction errors

## Backward Compatibility

### ✓ Unaffected Functionality

1. **Normal URL Extraction** (no bot protection):
   - jina_reader succeeds → Returns immediately
   - Proxy code path **never executed**
   - No performance impact

2. **YouTube Transcription**:
   - Uses separate YoutubeTranscript service
   - Not affected by extraction pipeline changes

3. **Media Processing**:
   - Images: `processImageBuffer()`
   - Videos: `processMediaBuffer()`
   - Documents: `processDocumentBuffer()`
   - Text input: `processText()`
   - All unaffected

4. **Gemini AI Analysis Pipeline**:
   - Receives extracted content
   - Analysis logic unchanged
   - JSON parsing logic unchanged

5. **API Routes**:
   - `POST /api/audit/create`
   - `POST /api/audit/validate`
   - Request/response contracts unchanged

## Testing

### Test Script

Run the comprehensive test:

```bash
node test-proxy-integration.js
```

This validates:
- ✓ Proxy environment configuration
- ✓ Bot protection phrase detection (13 phrases)
- ✓ Extraction pipeline sequence
- ✓ Proxy argument construction
- ✓ Conditional proxy enablement logic
- ✓ Backwards compatibility
- ✓ API route integrity

### Manual Testing

Test with a Cloudflare-protected site:

```bash
# Without proxy (should fail):
curl -X POST http://localhost:3001/api/audit/create \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.fortishealthcare.com", "category": "Healthcare"}'

# With PROXY_URL set in .env (should succeed):
# Set: PROXY_URL=http://proxy-address:port
npm start
# Then retry the curl above
```

## Performance Considerations

### Normal Case (No Bot Protection)
- **Execution**: jina_reader → Success
- **Latency**: ~2-5 seconds
- **Proxy**: Not used

### Bot Protected Case (With Proxy)
- **Execution**: jina_reader → mercury → puppeteer (with proxy)
- **Latency**: ~30-60 seconds (Puppeteer overhead)
- **Proxy**: Used on final retry

### Cost Considerations
- Proxy costs depend on provider and usage
- Only charged when extraction fails with bot protection
- Reduces manual review overhead significantly

## Deployment Checklist

Before deploying to production:

- [ ] Set `PROXY_URL` in environment variables
- [ ] Test with at least 5 Cloudflare-protected URLs
- [ ] Monitor logs for `[Scraper] Retrying with proxy...` messages
- [ ] Verify HTTP 403 errors are returned correctly
- [ ] Check API routes return proper status codes
- [ ] Validate YouTube transcription still works
- [ ] Test media upload functionality
- [ ] Verify text/document processing unaffected

## Troubleshooting

### Issue: "PROXY_URL environment variable not set - proxy retry disabled"

**Solution**: Add `PROXY_URL` to `.env`:
```bash
PROXY_URL=http://proxy-host:port
```

### Issue: Proxy connection fails

**Check**:
1. Proxy URL format: `http://host:port` or `http://user:pass@host:port`
2. Proxy accessibility from server network
3. Proxy authentication credentials
4. Firewall rules allowing outbound proxy connections

### Issue: Content still blocked even with proxy

**Possible causes**:
1. Proxy is also blocked by Cloudflare
2. Website requires authentication beyond bot detection
3. Website actively blocks Puppeteer even with proxy
4. Rotate to different proxy IP

### Issue: Performance degradation

**Check**:
1. Proxy latency: Should be <500ms
2. Browser timeout settings
3. Network conditions
4. Consider proxy provider with higher performance tier

## Monitoring and Analytics

### Key Metrics to Track

1. **Bot Protection Detection Rate**
   ```
   [Scraper] Retrying with proxy... occurrences per day
   ```

2. **Proxy Success Rate**
   - Successful content extraction with proxy
   - vs. failed with proxy

3. **Extraction Method Distribution**
   - jina_reader success rate
   - mercury parser success rate
   - puppeteer (non-proxy) success rate
   - puppeteer (with proxy) success rate

4. **Latency Analysis**
   - Average extraction time per method
   - Impact on API response times

### Sample Monitoring Query

```javascript
// Find all bot protection retries in last 24h
logs.filter(l => l.includes('[Scraper] Retrying with proxy...'))
    .filter(l => new Date(l.timestamp) > Date.now() - 86400000)
    .length
```

## Future Enhancements

1. **Rotating Proxy Pool**
   - Support multiple proxies
   - Automatic rotation on failures

2. **Proxy Performance Metrics**
   - Track per-proxy success rates
   - Smart proxy selection

3. **Adaptive Retry Strategy**
   - Learn which extraction methods work best per domain
   - Cache extraction method preferences

4. **Webhook Notifications**
   - Alert on persistent bot protection
   - Notify on high failure rates

5. **Proxy Caching**
   - Cache successful proxy extractions
   - Reduce redundant proxy usage

## References

- Cloudflare Bot Management: https://www.cloudflare.com/products/bot-management/
- Puppeteer Stealth Plugin: https://github.com/berstend/puppeteer-extra
- Proxy Server Formats: https://chromedriver.chromium.org/security-considerations

## Support

For issues or questions about proxy integration:

1. Check logs for `[Scraper]` messages
2. Run `node test-proxy-integration.js`
3. Review `BOT_PROTECTION_IMPLEMENTATION_COMPLETE.md`
4. Consult proxy provider documentation

---

**Last Updated**: March 5, 2026
**Status**: ✓ Production Ready
**Tested Against**: Cloudflare, Fortis Healthcare, Generic bot protection
