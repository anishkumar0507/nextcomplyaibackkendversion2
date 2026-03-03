import OpenAI from 'openai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Transcription Service
 * Uses OpenAI gpt-4o-transcribe model for audio/video transcription
 * 
 * IMPORTANT: OpenAI is used ONLY for transcription
 * NEVER uses Gemini - Gemini is reserved for compliance analysis
 */

const DIRECT_TRANSCRIBE_THRESHOLD = 20 * 1024 * 1024; // 20MB
const MAX_MEDIA_SIZE = 500 * 1024 * 1024; // 500MB
const CHUNK_DURATION_SECONDS = 600; // 10 minutes per chunk
const MODEL = 'gpt-4o-transcribe'; // OpenAI transcription model

// OpenAI client instance (singleton pattern)
let openaiClient = null;

/**
 * Get or create OpenAI client instance
 * Uses OPENAI_API_KEY from environment
 * @returns {OpenAI} OpenAI client
 */
const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. Required for transcription.');
    }
    
    openaiClient = new OpenAI({
      apiKey: apiKey
    });
    
    console.log('[Transcription] OpenAI client initialized');
  }
  
  return openaiClient;
};

/**
 * Validate audio/video file
 * @param {Buffer} buffer - File buffer
 * @param {string} mimetype - MIME type
 * @returns {void}
 */
const validateMediaFile = (buffer, mimetype) => {
  if (buffer.length > MAX_MEDIA_SIZE) {
    throw new Error(`File size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds ${MAX_MEDIA_SIZE / 1024 / 1024}MB limit`);
  }
  
  const allowedTypes = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg',
    'audio/m4a', 'audio/flac',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg'
  ];
  
  if (!allowedTypes.some(type => mimetype.includes(type.split('/')[1]))) {
    throw new Error(`Unsupported media type: ${mimetype}`);
  }
};

/**
 * Convert MIME type to file extension
 * @param {string} mimetype - Original MIME type
 * @returns {string} File extension
 */
const getFileExtension = (mimetype) => {
  const mimeMap = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav',
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/m4a': 'm4a',
    'audio/flac': 'flac',
    'video/mp4': 'mp4', 'video/webm': 'webm',
    'video/quicktime': 'mov', 'video/mpeg': 'mpeg'
  };
  
  for (const [mime, ext] of Object.entries(mimeMap)) {
    if (mimetype.includes(mime.split('/')[1])) {
      return ext;
    }
  }
  
  return 'mp3'; // Default fallback
};

const getFfmpegBinaryPath = (binaryName) => {
  const configured = (process.env.FFMPEG_PATH || '').trim();

  if (!configured) {
    return binaryName;
  }

  if (configured.toLowerCase().endsWith('.exe')) {
    const configuredName = path.basename(configured).toLowerCase();
    if (configuredName === `${binaryName}.exe`) {
      return configured;
    }
    return path.join(path.dirname(configured), `${binaryName}.exe`);
  }

  return path.join(configured, `${binaryName}.exe`);
};

const runProcess = (command, args, label) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
};

const transcribeDirectFile = async (filePath) => {
  const openai = getOpenAIClient();

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: MODEL,
    language: 'en',
    response_format: 'text',
    prompt: 'This is a healthcare advertisement. Transcribe all spoken words, claims, and marketing messages accurately.'
  });

  let transcript = '';
  if (typeof transcription === 'string') {
    transcript = transcription;
  } else if (transcription?.text) {
    transcript = transcription.text;
  }

  const trimmed = transcript.trim();
  if (!trimmed) {
    throw new Error('Transcription returned empty result');
  }

  return trimmed;
};

const splitIntoAudioChunks = async (filePath, outputDir) => {
  const ffmpegPath = getFfmpegBinaryPath('ffmpeg');
  const pattern = path.join(outputDir, 'chunk_%03d.mp3');

  await runProcess(
    ffmpegPath,
    [
      '-y',
      '-i', filePath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-acodec', 'libmp3lame',
      '-f', 'segment',
      '-segment_time', String(CHUNK_DURATION_SECONDS),
      pattern
    ],
    'FFmpeg chunk split'
  );

  const chunkFiles = fs.readdirSync(outputDir)
    .filter((name) => /^chunk_\d{3}\.mp3$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(outputDir, name));

  if (!chunkFiles.length) {
    throw new Error('Chunk split produced no output files');
  }

  return chunkFiles;
};

const transcribeChunked = async (filePath) => {
  const chunkDir = path.join(os.tmpdir(), `transcribe-chunks-${Date.now()}`);
  fs.mkdirSync(chunkDir, { recursive: true });

  try {
    const chunkFiles = await splitIntoAudioChunks(filePath, chunkDir);
    const transcriptParts = [];

    for (let index = 0; index < chunkFiles.length; index += 1) {
      console.log(`[Chunk] Processing chunk ${index + 1}/${chunkFiles.length}`);
      const part = await transcribeDirectFile(chunkFiles[index]);
      transcriptParts.push(part);
    }

    return transcriptParts.join('\n').trim();
  } finally {
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn('[Transcription] Failed to cleanup chunk directory:', cleanupError.message);
    }
  }
};

export const transcribeSmart = async (filePath) => {
  const stats = fs.statSync(filePath);
  const sizeBytes = stats.size;

  if (sizeBytes > MAX_MEDIA_SIZE) {
    throw new Error(`File size (${(sizeBytes / 1024 / 1024).toFixed(2)}MB) exceeds ${MAX_MEDIA_SIZE / 1024 / 1024}MB limit`);
  }

  if (sizeBytes <= DIRECT_TRANSCRIBE_THRESHOLD) {
    console.log('[Chunk] Direct mode');
    return await transcribeDirectFile(filePath);
  }

  console.log('[Chunk] Chunk mode');
  return await transcribeChunked(filePath);
};

/**
 * Transcribe audio/video using OpenAI gpt-4o-transcribe
 * @param {Buffer} audioBuffer - Audio/video file buffer
 * @param {string} mimetype - MIME type
 * @returns {Promise<{transcript: string, model: string, processingTime: number}>}
 */
export const transcribe = async (audioBuffer, mimetype) => {
  const startTime = Date.now();
  
  try {
    validateMediaFile(audioBuffer, mimetype);
    
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set. OpenAI is required for transcription.');
    }
    
    console.log(`[Transcription] Starting transcription with ${MODEL}...`);
    
    // Create temporary file for OpenAI API
    const tempFilePath = path.join(__dirname, `temp_audio_${Date.now()}.${getFileExtension(mimetype)}`);
    
    try {
      // Write buffer to temporary file
      fs.writeFileSync(tempFilePath, audioBuffer);
      
      const transcript = await transcribeSmart(tempFilePath);
      
      const processingTime = Date.now() - startTime;
      console.log(`[Transcription] Success | Model: ${MODEL} | Length: ${transcript.length} chars | Time: ${processingTime}ms`);
      
      return {
        transcript: transcript.trim(),
        model: MODEL,
        processingTime
      };
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        console.warn('[Transcription] Failed to cleanup temp file:', cleanupError.message);
      }
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[Transcription] Error | Model: ${MODEL} | Time: ${processingTime}ms | Error:`, error.message);
    
    // Provide helpful error messages
    if (error.message?.includes('API key')) {
      throw new Error('OpenAI API key is invalid or missing. Check OPENAI_API_KEY environment variable.');
    }
    
    if (error.message?.includes('file size') || error.message?.includes('exceeds')) {
      throw new Error(`File size exceeds maximum limit of ${MAX_MEDIA_SIZE / 1024 / 1024}MB`);
    }
    
    // Return structured error response
    throw {
      error: 'Transcription failed',
      message: error.message,
      model: MODEL,
      processingTime: Date.now() - startTime
    };
  }
};

export default {
  transcribe,
  transcribeSmart
};
