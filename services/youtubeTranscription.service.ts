import fs from 'fs';
import os from 'os';
import path from 'path';
import ytdlp from 'yt-dlp-exec';
import { spawn } from 'child_process';
import { transcribeSmart } from './transcriptionService.js';

// Proxy configuration - check process.env.PROXY_URL first
const buildProxyUrl = (): string | null => {
  // Direct PROXY_URL env variable (primary source)
  if (process.env.PROXY_URL) {
    console.log('[YouTube] ✅ Proxy enabled from PROXY_URL');
    return process.env.PROXY_URL;
  }

  // Fallback to component-based proxy construction
  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const id = process.env.PROXY_ID;
  const password = process.env.PROXY_PASSWORD;

  const missing: string[] = [];
  if (!host) missing.push('PROXY_HOST');
  if (!port) missing.push('PROXY_PORT');
  if (!id) missing.push('PROXY_ID');
  if (!password) missing.push('PROXY_PASSWORD');

  if (missing.length > 0) {
    console.log('[YouTube] Proxy in use: NO');
    console.log('[YouTube] ⚠️  Proxy disabled (env variables missing)');
    console.log('[YouTube] Missing variables:', missing.join(', '));
    return null;
  }

  const proxyUrl = `http://${id}:${password}@${host}:${port}`;
  console.log(`[YouTube] ✅ Proxy enabled: ${host}:${port}`);
  return proxyUrl;
};

const proxyUrl = buildProxyUrl();

const safeDelete = async (filePath: string): Promise<void> => {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[YouTube] Failed to delete temp file:', (error as Error).message);
    }
  }
};

const runYtDlpFallback = async (url: string, outputPath: string): Promise<void> => {
  const args = [
    '-x',
    '--audio-format', 'mp3',
    '-o', outputPath,
    '--geo-bypass',
    '--no-check-certificates',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  ];

  if (proxyUrl) {
    console.log('[YouTube] Adding proxy to yt-dlp binary fallback');
    args.push('--proxy', proxyUrl);
  }

  args.push(url);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('yt-dlp', args, { windowsHide: true });
    let stderr = '';
    let stdout = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('yt-dlp not found in PATH. Please install yt-dlp and ensure it is available in PATH.'));
        return;
      }
      reject(new Error(`yt-dlp failed to start: ${(error as Error).message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const message = [
          'yt-dlp fallback failed.',
          `exit code: ${code ?? 'unknown'}`,
          stderr ? `stderr: ${stderr}` : '',
          stdout ? `stdout: ${stdout}` : ''
        ]
          .filter(Boolean)
          .join(' ');
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
};

const downloadYoutubeAudio = async (url: string): Promise<string> => {
  const tempPath = path.join(os.tmpdir(), `yt-audio-${Date.now()}.mp3`);

  try {
    console.log(`[YouTube] ===== PROXY CONFIGURATION =====`);
    console.log(`[YouTube] Proxy in use: ${proxyUrl ? 'YES' : 'NO'}`);
    if (proxyUrl) {
      console.log(`[YouTube] Proxy URL (masked): ${proxyUrl.replace(/:[^@]*@/, ':***@')}`);
    }
    console.log(`[YouTube] forceIpv4: true (prevents 410 errors)`);
    console.log(`[YouTube] geoBypass: true (bypasses geo restrictions)`);
    console.log(`[YouTube] ==================================`);
    
    const options: Record<string, any> = {
      output: tempPath,
      extractAudio: true,
      audioFormat: 'mp3',
      format: 'bestaudio/best',
      noPlaylist: true,
      geoBypass: true,
      forceIpv4: true,
      noCheckCertificates: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    };

    if (proxyUrl) {
      options.proxy = proxyUrl;
    } else {
      console.warn('[YouTube] ⚠️ No proxy configured - may encounter 410 errors on Render');
    }

    console.log('[YouTube] Starting yt-dlp-exec download...');
    await ytdlp(url, options);
    console.log('[YouTube] yt-dlp-exec download succeeded');
  } catch (error) {
    console.warn('[YouTube] yt-dlp-exec failed, falling back to binary:', (error as Error).message);
    console.log('[YouTube] Attempting fallback with yt-dlp binary...');
    await runYtDlpFallback(url, tempPath);
  }

  return tempPath;
};

const transcribeAudioFile = async (filePath: string): Promise<string> => {
  return await transcribeSmart(filePath);
};

export const transcribeYoutubeUrl = async (url: string): Promise<string> => {
  let audioPath = '';
  try {
    console.log(`[YouTube] Starting transcription for: ${url}`);
    console.log('[YouTube] Proxy in use:', process.env.PROXY_URL ? 'YES' : 'NO');
    console.log(`[YouTube] Proxy in use: ${proxyUrl ? 'YES' : 'NO'}`);
    if (proxyUrl) {
      console.log(`[YouTube] Proxy URL (masked): ${proxyUrl.replace(/:[^@]*@/, ':***@')}`);
    }
    
    audioPath = await downloadYoutubeAudio(url);
    const transcript = await transcribeAudioFile(audioPath);
    console.log('[YouTube] Transcription completed successfully');
    return transcript;
  } catch (error) {
    console.error('[YouTube] Transcription failed:', (error as Error).message);
    throw new Error(`YouTube transcription failed: ${(error as Error).message}`);
  } finally {
    if (audioPath) {
      await safeDelete(audioPath);
    }
  }
};

export const transcribeMediaFile = async (filePath: string): Promise<string> => {
  return await transcribeAudioFile(filePath);
};

export default {
  transcribeYoutubeUrl,
  transcribeMediaFile
};
