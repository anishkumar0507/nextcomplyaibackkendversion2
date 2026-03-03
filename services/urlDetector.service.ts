const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'];
const DRIVE_HOSTS = ['drive.google.com', 'docs.google.com'];
const MEDIA_EXTENSIONS = [
  '.mp3',
  '.mp4',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.webm',
  '.mov',
  '.avi',
  '.mkv'
];

type UrlType = 'youtube' | 'media' | 'webpage' | 'drive';

type UrlDetectionResult = {
  normalizedUrl: string;
  type: UrlType;
  fileId?: string; // For Google Drive links
};

const normalizeUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must start with http or https');
  }

  return parsed.toString();
};

const hasMediaExtension = (url: URL): boolean => {
  const pathname = url.pathname.toLowerCase();
  return MEDIA_EXTENSIONS.some((ext) => pathname.endsWith(ext));
};

const isYouTubeHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return YOUTUBE_HOSTS.some((ytHost) => host === ytHost || host.endsWith(`.${ytHost}`));
};
const isGoogleDriveUrl = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return DRIVE_HOSTS.some(driveHost => host === driveHost || host.endsWith(`.${driveHost}`)) &&
         (pathname.includes('/file/d/') || pathname.includes('/open?id=') || pathname.includes('/uc?'));
};

const extractDriveFileId = (url: URL): string | null => {
  const pathname = url.pathname;
  const searchParams = url.searchParams;
  
  // Pattern 1: /file/d/{fileId}/...
  const fileMatch = pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];
  
  // Pattern 2: /open?id={fileId}
  if (searchParams.has('id')) return searchParams.get('id');
  
  // Pattern 3: Already a direct download link /uc?export=download&id={fileId}
  if (pathname.includes('/uc') && searchParams.has('id')) return searchParams.get('id');
  
  return null;
};

export const detectUrlType = (url: string): UrlDetectionResult => {
  const normalizedUrl = normalizeUrl(url);
  const parsed = new URL(normalizedUrl);

  if (isYouTubeHost(parsed.hostname)) {
    return { normalizedUrl, type: 'youtube' };
  }

  if (isGoogleDriveUrl(parsed)) {
    const fileId = extractDriveFileId(parsed);
    if (fileId) {
      // Convert to direct download URL
      const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      return { normalizedUrl: directUrl, type: 'drive', fileId };
    }
    return { normalizedUrl, type: 'youtube' };
  }

  if (hasMediaExtension(parsed)) {
    return { normalizedUrl, type: 'media' };
  }

  return { normalizedUrl, type: 'webpage' };
};

export default {
  detectUrlType
};
