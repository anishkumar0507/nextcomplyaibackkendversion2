import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import ytdl from 'ytdl-core';
import { YoutubeTranscript } from 'youtube-transcript';
import { spawn } from 'child_process';
import { transcribeSmart } from './transcriptionService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIO_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 800;
const BACKOFF_FACTOR = 2;
const YTDL_EXTRACT_FAILURE = /could not extract functions/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const retryWithBackoff = async (fn, attempts, label) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[YouTube Transcript] ${label} failed (attempt ${attempt}/${attempts}):`, error.message);
      if (attempt < attempts) {
        const backoffMs = BACKOFF_BASE_MS * (BACKOFF_FACTOR ** (attempt - 1));
        await sleep(backoffMs);
      }
    }
  }

  throw lastError;
};

const normalizeUrl = (videoUrl) => {
  try {
    const parsed = new URL(videoUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must start with http or https');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error('Invalid YouTube URL');
  }
};

const getYtDlpCommand = () => process.env.YTDL_PATH || 'yt-dlp';
const getYtDlpJsRuntime = () => process.env.YTDL_JS_RUNTIME || 'node';
const getFfmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';
const getFfprobePath = () => process.env.FFPROBE_PATH || 'ffprobe';

const downloadWithYtDlp = async (videoUrl, outputPath) => {
  console.log('[YouTube Transcript] Downloading audio with yt-dlp + FFmpeg MP3 re-encode...');

  await withTimeout(new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const args = [
      '--js-runtimes',
      getYtDlpJsRuntime(),
      '--ffmpeg-location',
      ffmpegPath,
      '-x',
      '--audio-format',
      'mp3',
      '-o',
      outputPath,
      videoUrl
    ];

    const process = spawn(getYtDlpCommand(), args);

    let stderr = '';
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', (error) => {
      reject(error);
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yt-dlp failed (code ${code}): ${stderr.trim()}`));
    });
  }), AUDIO_TIMEOUT_MS, 'yt-dlp download timed out');

  console.log('[YouTube Transcript] yt-dlp audio downloaded successfully');
};

const getAudioDurationSeconds = async (filePath) => {
  const ffprobePath = getFfprobePath();

  return await withTimeout(new Promise((resolve, reject) => {
    const process = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);

    let output = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('error', reject);
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (code ${code}): ${stderr.trim()}`));
        return;
      }
      const duration = parseFloat(output.trim());
      resolve(duration);
    });
  }), AUDIO_TIMEOUT_MS, 'Audio duration probe timed out');
};

const validateDownloadedAudio = async (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('Downloaded audio file not found');
  }

  const stats = fs.statSync(filePath);
  if (!stats.size || stats.size <= 0) {
    throw new Error('Downloaded audio file is empty');
  }

  const duration = await getAudioDurationSeconds(filePath);
  if (!duration || Number.isNaN(duration) || duration <= 0) {
    throw new Error('Downloaded audio has invalid duration');
  }
};

const validateYoutubeUrl = async (videoUrl) => {
  if (!ytdl.validateURL(videoUrl)) {
    throw new Error('Invalid YouTube URL');
  }

  try {
    const info = await retryWithBackoff(() => ytdl.getInfo(videoUrl), MAX_RETRIES, 'Video info');
    const isPrivate = info?.videoDetails?.isPrivate;
    const isLive = info?.videoDetails?.isLiveContent;
    if (isPrivate) {
      throw new Error('YouTube video is private');
    }
    if (isLive) {
      console.warn('[YouTube Transcript] Video is live content. Transcript may be unavailable.');
    }
  } catch (error) {
    if (YTDL_EXTRACT_FAILURE.test(error.message || '')) {
      console.warn('[YouTube Transcript] Video info unavailable via ytdl-core. Continuing with yt-dlp fallback.');
      return;
    }
    throw error;
  }
};

export const downloadYoutubeAudio = async (videoUrl, outputPath) => {
  console.log('[YouTube Transcript] Downloading audio...');
  await validateYoutubeUrl(videoUrl);
  await downloadWithYtDlp(videoUrl, outputPath);
  await validateDownloadedAudio(outputPath);
};

export const transcribeAudioWithOpenAI = async (filePath) => {
  console.log('[YouTube Transcript] Transcribing audio...');
  const text = await transcribeSmart(filePath);

  console.log('[YouTube Transcript] Transcription completed');
  return text;
};

export const getYoutubeTranscript = async (videoUrl) => {
  const normalized = normalizeUrl(videoUrl);
  await validateYoutubeUrl(normalized);

  console.log('[YouTube Transcript] Trying captions...');
  try {
    const transcriptItems = await retryWithBackoff(() => YoutubeTranscript.fetchTranscript(normalized), MAX_RETRIES, 'Captions fetch');
    const transcript = transcriptItems.map((item) => item.text).join(' ').replace(/\s+/g, ' ').trim();
    if (transcript) {
      return transcript;
    }
    console.warn('[YouTube Transcript] Captions empty. Switching to audio transcription...');
  } catch (error) {
    console.warn('[YouTube Transcript] Captions disabled. Switching to audio transcription...');
  }

  const tempFile = path.join(os.tmpdir(), `yt-audio-${Date.now()}.mp3`);
  try {
    await retryWithBackoff(() => downloadYoutubeAudio(normalized, tempFile), MAX_RETRIES, 'Audio download');
    return await transcribeAudioWithOpenAI(tempFile);
  } catch (error) {
    console.warn('[YouTube Transcript] Audio transcription failed. Returning fallback text:', error.message);
    return `YouTube transcript unavailable. Reason: ${error.message}. Video URL: ${normalized}`;
  } finally {
    fs.unlink(tempFile, () => undefined);
  }
};

export default {
  downloadYoutubeAudio,
  transcribeAudioWithOpenAI,
  getYoutubeTranscript
};
