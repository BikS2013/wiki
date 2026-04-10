// src/source/youtube.ts -- Fetch and save YouTube video transcripts via yt-dlp

import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface YouTubeContent {
  videoId: string;
  title: string;
  transcript: string;
  url: string;
}

/**
 * Extract the YouTube video ID from a URL.
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
 */
export function extractVideoId(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
    return parsed.searchParams.get('v')!;
  }

  if (parsed.hostname === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('?')[0];
    if (id) return id;
  }

  if (parsed.hostname.includes('youtube.com') && parsed.pathname.startsWith('/embed/')) {
    const id = parsed.pathname.split('/')[2];
    if (id) return id;
  }

  throw new Error(`Could not extract video ID from URL: ${url}`);
}

/**
 * Fetch the transcript of a YouTube video using yt-dlp.
 * Requires yt-dlp to be installed and available in PATH.
 *
 * @throws Error if yt-dlp is not installed or no captions are available.
 */
export async function fetchYouTubeTranscript(url: string): Promise<YouTubeContent> {
  const videoId = extractVideoId(url);

  // Check yt-dlp is available
  try {
    execSync('yt-dlp --version', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'yt-dlp is not installed. Install it with: brew install yt-dlp',
    );
  }

  // Create temp directory for subtitle download
  const tempDir = join(tmpdir(), `wiki-yt-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const tempBase = join(tempDir, 'sub');

  try {
    // Get video title
    let title = videoId;
    try {
      title = execSync(
        `yt-dlp --get-title "${url}"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
    } catch {
      // Fall back to video ID
    }

    // Download subtitles (try manual subs first, then auto-generated)
    let vttFile: string | null = null;

    // Try manual subtitles first
    try {
      execSync(
        `yt-dlp --write-sub --sub-lang en --sub-format vtt --skip-download -o "${tempBase}" "${url}"`,
        { stdio: 'pipe' },
      );
      vttFile = `${tempBase}.en.vtt`;
      await readFile(vttFile, 'utf-8'); // verify it exists and is readable
    } catch {
      vttFile = null;
    }

    // Fall back to auto-generated subtitles
    if (!vttFile) {
      try {
        execSync(
          `yt-dlp --write-auto-sub --sub-lang en --sub-format vtt --skip-download -o "${tempBase}" "${url}"`,
          { stdio: 'pipe' },
        );
        vttFile = `${tempBase}.en.vtt`;
        await readFile(vttFile, 'utf-8');
      } catch {
        throw new Error(
          `No captions available for video ${videoId}. The video may not have English subtitles.`,
        );
      }
    }

    // Parse VTT file into clean text with timestamps
    const vttContent = await readFile(vttFile, 'utf-8');
    const transcript = parseVtt(vttContent);

    if (transcript.length === 0) {
      throw new Error(`Empty transcript for video: ${videoId}`);
    }

    return {
      videoId,
      title,
      transcript,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } finally {
    // Clean up temp files
    try {
      const { readdirSync } = await import('node:fs');
      for (const f of readdirSync(tempDir)) {
        await unlink(join(tempDir, f));
      }
      const { rmdirSync } = await import('node:fs');
      rmdirSync(tempDir);
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Parse a VTT subtitle file into clean timestamped text.
 * Deduplicates repeated lines (VTT often has overlapping cues)
 * and strips HTML tags from the text.
 */
function parseVtt(vtt: string): string {
  const lines = vtt.split('\n');
  const segments: Array<{ time: string; text: string }> = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    // Look for timestamp lines (HH:MM:SS.mmm --> HH:MM:SS.mmm)
    const timestampMatch = lines[i].match(
      /^(\d{2}:\d{2}:\d{2})\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/,
    );
    if (timestampMatch) {
      const time = timestampMatch[1];
      i++;
      // Collect text lines until next blank line
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i++;
      }
      // Strip HTML/VTT tags and clean up
      const text = textLines
        .join(' ')
        .replace(/<[^>]+>/g, '') // Strip HTML tags
        .replace(/\{[^}]+\}/g, '') // Strip VTT positioning
        .trim();

      if (text && !seen.has(text)) {
        seen.add(text);
        // Convert HH:MM:SS to MM:SS for readability
        const parts = time.split(':');
        const hours = parseInt(parts[0]);
        const mins = parseInt(parts[1]);
        const secs = parseInt(parts[2]);
        const totalMins = hours * 60 + mins;
        const timeStr = `[${String(totalMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}]`;
        segments.push({ time: timeStr, text });
      }
    }
    i++;
  }

  return segments.map((s) => `${s.time} ${s.text}`).join('\n');
}

/**
 * Fetch a YouTube transcript and save it as a markdown file.
 * Returns the path to the saved file.
 */
export async function saveYouTubeTranscriptToFile(
  url: string,
  destDir: string,
): Promise<string> {
  await mkdir(destDir, { recursive: true });
  const yt = await fetchYouTubeTranscript(url);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slugTitle = yt.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const filename = `youtube-${slugTitle}-${timestamp}.md`;
  const filePath = join(destDir, filename);

  const content = [
    `# ${yt.title}`,
    '',
    `> Source: ${yt.url}`,
    `> Type: YouTube Video Transcript`,
    `> Video ID: ${yt.videoId}`,
    '',
    '---',
    '',
    '## Transcript',
    '',
    yt.transcript,
  ].join('\n');

  await writeFile(filePath, content, 'utf-8');
  return filePath;
}
