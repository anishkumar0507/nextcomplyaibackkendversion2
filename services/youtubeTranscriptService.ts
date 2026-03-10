import fs from 'fs';
import os from 'os';
import path from 'path';
import ytdl from 'ytdl-core';
import { YoutubeTranscript } from 'youtube-transcript';
import { spawn } from 'child_process';
import { transcribeSmart } from './transcriptionService.js';

const AUDIO_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 800;
const BACKOFF_FACTOR = 2;
const YTDL_EXTRACT_FAILURE = /could not extract functions/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const retryWithBackoff = async <T>(fn: () => Promise<T>, attempts: number, label: string): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[YouTube Transcript] ${label} failed (attempt ${attempt}/${attempts}):`, message);
      if (attempt < attempts) {
        const backoffMs = BACKOFF_BASE_MS * (BACKOFF_FACTOR ** (attempt - 1));
        await sleep(backoffMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown error');
};

const normalizeUrl = (videoUrl: string): string => {
  try {
    const parsed = new URL(videoUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must start with http or https');
    }
    return parsed.toString();
  } catch {
    throw new Error('Invalid YouTube URL');
  }
};

const getYtDlpCommand = (): string => process.env.YTDL_PATH || 'yt-dlp';
const getYtDlpJsRuntime = (): string => process.env.YTDL_JS_RUNTIME || 'node';
const getFfmpegPath = (): string => process.env.FFMPEG_PATH || 'ffmpeg';
const getFfprobePath = (): string => process.env.FFPROBE_PATH || 'ffprobe';

const downloadWithYtDlp = async (videoUrl: string, outputPath: string): Promise<void> => {
  console.log('[YouTube Transcript] Downloading audio with yt-dlp + FFmpeg MP3 re-encode...');

  await withTimeout(new Promise<void>((resolve, reject) => {
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

const getAudioDurationSeconds = async (filePath: string): Promise<number> => {
  const ffprobePath = getFfprobePath();

  return await withTimeout(new Promise<number>((resolve, reject) => {
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

const validateDownloadedAudio = async (filePath: string): Promise<void> => {
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

const validateYoutubeUrl = async (videoUrl: string): Promise<void> => {
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
    const message = error instanceof Error ? error.message : String(error);
    if (YTDL_EXTRACT_FAILURE.test(message)) {
      console.warn('[YouTube Transcript] Video info unavailable via ytdl-core. Continuing with yt-dlp fallback.');
      return;
    }
    throw error instanceof Error ? error : new Error(message);
  }
};

export const downloadYoutubeAudio = async (videoUrl: string, outputPath: string): Promise<void> => {
  console.log('[YouTube Transcript] Downloading audio...');
  await validateYoutubeUrl(videoUrl);
  await downloadWithYtDlp(videoUrl, outputPath);
  await validateDownloadedAudio(outputPath);
};

export const transcribeAudioWithOpenAI = async (filePath: string): Promise<string> => {
  console.log('[YouTube Transcript] Transcribing audio...');
  const text = await transcribeSmart(filePath);

  console.log('[YouTube Transcript] Transcription completed');
  return text;
};

export const getYoutubeTranscript = async (videoUrl: string): Promise<string> => {
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
  } catch {
    console.warn('[YouTube Transcript] Captions disabled. Switching to audio transcription...');
  }

  const tempFile = path.join(os.tmpdir(), `yt-audio-${Date.now()}.mp3`);
  try {
    await retryWithBackoff(() => downloadYoutubeAudio(normalized, tempFile), MAX_RETRIES, 'Audio download');
    return await transcribeAudioWithOpenAI(tempFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[YouTube Transcript] Audio transcription failed. Returning fallback text:', message);
    return `YouTube transcript unavailable. Reason: ${message}. Video URL: ${normalized}`;
  } finally {
    fs.unlink(tempFile, () => undefined);
  }
};

export default {
  downloadYoutubeAudio,
  transcribeAudioWithOpenAI,
  getYoutubeTranscript
};
