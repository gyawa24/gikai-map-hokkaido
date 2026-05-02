import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export const YT_DLP = "/opt/homebrew/bin/yt-dlp";
export const FFMPEG = "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = "/opt/homebrew/bin/ffprobe";

export function resolveSourceUrl(entry) {
  if (entry.source_url) return entry.source_url;
  if (entry.youtube_id) return `https://www.youtube.com/watch?v=${entry.youtube_id}`;
  return null;
}

export function downloadAudio(sourceUrl, outputPath, ytDlpPath = YT_DLP, options = {}) {
  const { maxSeconds } = options;
  if (/\.m3u8($|\?)/.test(sourceUrl)) {
    const ffmpegArgs = [
      "-y",
      "-loglevel",
      "error",
      "-nostats",
      ...(maxSeconds ? ["-t", String(maxSeconds)] : []),
      "-i",
      sourceUrl,
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      outputPath,
    ];
    const ff = spawnSync(FFMPEG, [
      ...ffmpegArgs,
    ], { stdio: "pipe" });
    if (ff.status !== 0) {
      throw new Error(`ffmpeg capture failed: ${ff.stderr?.toString().slice(0, 200)}`);
    }
    return;
  }

  const dl = spawnSync(ytDlpPath, [
    "--no-progress",
    "--ffmpeg-location",
    path.dirname(FFMPEG),
    "--downloader",
    "ffmpeg",
    "--hls-use-mpegts",
    "--retries",
    "10",
    "--fragment-retries",
    "20",
    "-f",
    "bestaudio/best",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputPath,
    sourceUrl,
  ], { stdio: "pipe" });
  if (dl.status !== 0) {
    throw new Error(`yt-dlp failed: ${dl.stderr?.toString().slice(0, 200)}`);
  }
}

function escapeConcatPath(fp) {
  return fp.replaceAll("'", "'\\''");
}

function removeIfExists(fp) {
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

export function prepareSessionAudio({
  entryId,
  sourceUrl,
  sourceSegments = [],
  outputPath,
  tmpDir,
  ytDlpPath = YT_DLP,
  keepParts = false,
  maxSeconds = null,
}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  if (!sourceSegments.length) {
    downloadAudio(sourceUrl, outputPath, ytDlpPath, { maxSeconds });
    return {
      mode: "single",
      sourceCount: 1,
      outputPath,
      partPaths: [],
      partsDir: null,
    };
  }

  const partPaths = [];
  const partsDir = path.join(tmpDir, `${entryId}-parts`);
  fs.mkdirSync(partsDir, { recursive: true });

  for (let i = 0; i < sourceSegments.length; i++) {
    const segment = sourceSegments[i];
    const segmentUrl = segment.media_url ?? segment.source_url ?? segment.view_url;
    if (!segmentUrl) throw new Error(`segment source missing: ${i + 1}`);
    const partPath = path.join(partsDir, `${String(i + 1).padStart(3, "0")}.mp3`);
    if (!fs.existsSync(partPath)) {
      downloadAudio(segmentUrl, partPath, ytDlpPath);
    }
    partPaths.push(partPath);
  }

  const concatPath = path.join(tmpDir, `${entryId}-concat.txt`);
  fs.writeFileSync(
    concatPath,
    partPaths.map((part) => `file '${escapeConcatPath(part)}'`).join("\n") + "\n",
    "utf-8"
  );

  const ff = spawnSync(FFMPEG, [
    "-y",
    "-loglevel",
    "error",
    "-nostats",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    outputPath,
  ], { stdio: "pipe" });
  removeIfExists(concatPath);

  if (ff.status !== 0) {
    throw new Error(`ffmpeg concat failed: ${ff.stderr?.toString().slice(0, 200)}`);
  }

  if (!keepParts) {
    for (const part of partPaths) removeIfExists(part);
    if (fs.existsSync(partsDir) && fs.readdirSync(partsDir).length === 0) {
      fs.rmdirSync(partsDir);
    }
  }

  return {
    mode: "segments",
    sourceCount: sourceSegments.length,
    outputPath,
    partPaths: keepParts ? partPaths : [],
    partsDir: keepParts ? partsDir : null,
  };
}
