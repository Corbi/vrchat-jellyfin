// src/hls/hlsGenerator.ts

import { EventEmitter } from "events";
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { resolve } from "path";

const encodingSettings: Record<string, string> = require(resolve("./encodingSettings.js")).encodingSettings;

export interface HLSSegment {
  index: number;
  filename: string;
  duration: number;
}

/**
 * HLS Generator: Converts a video stream into HLS segments
 * Creates .ts segment files and a .m3u8 playlist
 */
export class HLSGenerator extends EventEmitter {
  private sessionId: string;
  private segmentDir: string;
  private segmentDuration: number = 2; // 2 seconds per segment
  private segments: HLSSegment[] = [];
  private segmentIndex: number = 0;
  private isRunning: boolean = false;
  private ffmpegProcess: ffmpeg.FfmpegCommand | null = null;
  private maxSegments: number = 10; // Keep last 10 segments in buffer
  private targetDuration: number = 2;

  constructor(sessionId: string, basePath: string = "hls_segments") {
    super();
    this.sessionId = sessionId;
    this.segmentDir = path.join(basePath, sessionId);

    // Create segment directory
    if (!fs.existsSync(this.segmentDir)) {
      fs.mkdirSync(this.segmentDir, { recursive: true });
    }
  }

  /**
   * Start HLS streaming from an input source
   */
  public startStream(inputStream: Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        reject(new Error("Stream already running"));
        return;
      }

      this.isRunning = true;
      this.emit("start", { sessionId: this.sessionId });

      const segmentPattern = path.join(
        this.segmentDir,
        `segment_%05d.ts`
      );
      const playlistPath = path.join(this.segmentDir, "playlist.m3u8");

      this.ffmpegProcess = ffmpeg(inputStream)
        .outputOptions([
          "-c:v",
          encodingSettings.videoCodec || "h264",
          "-c:a",
          encodingSettings.audioCodec || "aac",
          "-b:v",
          encodingSettings.videoBitrate || "3000k",
          "-b:a",
          encodingSettings.audioBitrate || "128k",
          "-ac",
          encodingSettings.maxAudioChannels || "2",
          "-hls_time",
          this.segmentDuration.toString(),
          "-hls_list_size",
          this.maxSegments.toString(),
          "-hls_delete_threshold",
          "0",
          "-hls_flags",
          "delete_segments",
          "-f",
          "hls",
        ])
        .output(segmentPattern)
        .on("start", (commandLine) => {
          console.log("FFmpeg HLS process started:", commandLine);
        })
        .on("end", () => {
          console.log(`HLS stream ended for session ${this.sessionId}`);
          this.cleanup();
          this.emit("end", { sessionId: this.sessionId });
        })
        .on("error", (err) => {
          console.error(`FFmpeg error for session ${this.sessionId}:`, err);
          this.cleanup();
          this.emit("error", {
            sessionId: this.sessionId,
            error: err.message,
          });
          reject(err);
        })
        .run();

      // Monitor segment creation
      this.monitorSegments();
      resolve();
    });
  }

  /**
   * Monitor created segments and update internal list
   */
  private monitorSegments(): void {
    const monitor = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(monitor);
        return;
      }

      try {
        const files = fs
          .readdirSync(this.segmentDir)
          .filter((f) => f.endsWith(".ts"))
          .sort();

        const newSegments = files.map((file, idx) => ({
          index: idx,
          filename: file,
          duration: this.segmentDuration,
        }));

        // Emit new segments
        if (newSegments.length > this.segments.length) {
          const latestSegment =
            newSegments[newSegments.length - 1];
          this.emit("segment", latestSegment);
        }

        this.segments = newSegments;
      } catch (err) {
        console.error("Error monitoring segments:", err);
      }
    }, 500);
  }

  /**
   * Get the current playlist (m3u8)
   */
  public getPlaylist(): string {
    const lines: string[] = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${Math.max(0, this.segmentIndex - this.maxSegments)}`,
    ];

    for (const segment of this.segments) {
      lines.push("#EXTINF:" + segment.duration.toFixed(1) + ",");
      lines.push(segment.filename);
    }

    if (!this.isRunning) {
      lines.push("#EXT-X-ENDLIST");
    }

    return lines.join("\n");
  }

  /**
   * Get a specific segment file
   */
  public getSegmentFile(filename: string): string | null {
    const segmentPath = path.join(this.segmentDir, filename);

    // Security check: ensure path is within segmentDir
    if (!segmentPath.startsWith(this.segmentDir)) {
      return null;
    }

    if (fs.existsSync(segmentPath)) {
      return segmentPath;
    }

    return null;
  }

  /**
   * Stop the HLS stream
   */
  public stop(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill("SIGTERM");
    }
    this.isRunning = false;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.isRunning = false;
    try {
      // Keep segment directory for potential cleanup later
      // Don't delete immediately in case client is still reading
    } catch (err) {
      console.error("Error during cleanup:", err);
    }
  }

  /**
   * Get session info
   */
  public getSessionInfo() {
    return {
      sessionId: this.sessionId,
      isRunning: this.isRunning,
      segmentCount: this.segments.length,
      segments: this.segments,
    };
  }

  /**
   * Cleanup directory
   */
  public deleteSession(): void {
    try {
      if (fs.existsSync(this.segmentDir)) {
        fs.rmSync(this.segmentDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error("Error deleting session directory:", err);
    }
  }
}
