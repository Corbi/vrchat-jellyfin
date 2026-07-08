// src/hls/hlsManager.ts

import { HLSGenerator } from "./hlsGenerator";
import { v4 as uuidv4 } from "uuid";
import { Readable } from "stream";

/**
 * Manages multiple HLS streams
 */
export class HLSManager {
  private static streams: Map<string, HLSGenerator> = new Map();
  private static readonly CLEANUP_INTERVAL = 1000 * 60 * 60; // 1 hour
  private static cleanupTimer: NodeJS.Timeout;

  /**
   * Initialize HLS Manager
   */
  static init() {
    // Periodically clean up old sessions
    HLSManager.cleanupTimer = setInterval(() => {
      HLSManager.cleanupOldSessions();
    }, HLSManager.CLEANUP_INTERVAL);
  }

  /**
   * Create a new HLS stream
   */
  static createStream(inputStream: Readable): string {
    const sessionId = uuidv4();
    const generator = new HLSGenerator(sessionId);

    generator
      .startStream(inputStream)
      .catch((err) => console.error("Error starting HLS stream:", err));

    HLSManager.streams.set(sessionId, generator);
    return sessionId;
  }

  /**
   * Get an existing HLS stream
   */
  static getStream(sessionId: string): HLSGenerator | undefined {
    return HLSManager.streams.get(sessionId);
  }

  /**
   * Stop and remove a stream
   */
  static stopStream(sessionId: string): boolean {
    const generator = HLSManager.streams.get(sessionId);
    if (generator) {
      generator.stop();
      generator.deleteSession();
      HLSManager.streams.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Get all active streams
   */
  static getActiveStreams() {
    return Array.from(HLSManager.streams.entries()).map(([id, gen]) => ({
      sessionId: id,
      ...gen.getSessionInfo(),
    }));
  }

  /**
   * Clean up old sessions
   */
  private static cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 1000 * 60 * 60 * 24; // 24 hours

    for (const [sessionId, generator] of HLSManager.streams) {
      const sessionInfo = generator.getSessionInfo();
      // You might want to track creation time and clean up old ones
      if (!sessionInfo.isRunning) {
        generator.deleteSession();
        HLSManager.streams.delete(sessionId);
      }
    }
  }

  /**
   * Shutdown HLS Manager
   */
  static shutdown(): void {
    if (HLSManager.cleanupTimer) {
      clearInterval(HLSManager.cleanupTimer);
    }
    for (const [, generator] of HLSManager.streams) {
      generator.stop();
      generator.deleteSession();
    }
    HLSManager.streams.clear();
  }
}
