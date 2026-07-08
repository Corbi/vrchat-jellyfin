// src/jellyfin/cast/castClient.ts

import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";

export interface CastDeviceInfo {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  clientName: string;
  userId: string;
  accessToken: string;
}

export interface PlaybackCommand {
  itemId: string;
  startPositionTicks?: number;
  mediaSourceId?: string;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

/**
 * Jellyfin Cast Client - Registers as a casteable device
 * Allows Jellyfin to discover and cast to this client
 */
export class JellyfinCastClient {
  private deviceId: string;
  private deviceName: string;
  private serverUrl: string;
  private userId: string;
  private accessToken: string;
  private registrationTimer: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  constructor(
    serverUrl: string,
    userId: string,
    accessToken: string,
    deviceName: string = "VRChat Jellyfin Player"
  ) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.userId = userId;
    this.accessToken = accessToken;
    this.deviceName = deviceName;
    this.deviceId = uuidv4();
  }

  /**
   * Register this device with Jellyfin server
   */
  public async register(): Promise<boolean> {
    try {
      const deviceInfo = {
        DeviceId: this.deviceId,
        DeviceName: this.deviceName,
        DeviceType: "VRChat",
        AppVersion: process.env.npm_package_version || "1.0.0",
        Capabilities: {
          PlayableMediaTypes: ["Video", "Audio"],
          SupportedCommands: [
            "PlayVideo",
            "PlayAudio",
            "PlayItemWithArgument",
            "SetRepeatMode",
            "ToggleMute",
            "SetAudioStreamIndex",
            "SetSubtitleStreamIndex",
            "Mute",
            "Unmute",
            "VolumeUp",
            "VolumeDown",
            "SetVolume",
            "Stop",
            "Pause",
            "Unpause",
            "NextTrack",
            "PreviousTrack",
            "Seek",
          ],
          SupportsSyncPlayGroups: true,
          SupportsUniqueIdentifier: true,
        },
      };

      const url = `${this.serverUrl}/Sessions?api_key=${this.accessToken}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `VRChat Jellyfin/${process.env.npm_package_version || "1.0.0"}`,
        },
        body: JSON.stringify(deviceInfo),
      });

      if (response.status === 200 || response.status === 201) {
        console.log(`[CastClient] Device registered: ${this.deviceId}`);

        // Start heartbeat
        this.startHeartbeat();
        return true;
      } else {
        console.error(
          `[CastClient] Failed to register device: ${response.status} ${response.statusText}`
        );
        return false;
      }
    } catch (err) {
      console.error("[CastClient] Error registering device:", err);
      return false;
    }
  }

  /**
   * Send heartbeat to keep session alive
   */
  private startHeartbeat(): void {
    this.registrationTimer = setInterval(async () => {
      try {
        const url = `${this.serverUrl}/Sessions/Me/Playing/Ping?api_key=${this.accessToken}`;

        await fetch(url, {
          method: "POST",
          headers: {
            "User-Agent": `VRChat Jellyfin/${process.env.npm_package_version || "1.0.0"}`,
          },
        });
      } catch (err) {
        console.error("[CastClient] Heartbeat error:", err);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Report playback start
   */
  public async reportPlaybackStart(
    itemId: string,
    hlsSessionId: string
  ): Promise<void> {
    try {
      const url = `${this.serverUrl}/Sessions/Me/Playing?api_key=${this.accessToken}`;

      const playbackInfo = {
        ItemId: itemId,
        PlaySessionId: hlsSessionId,
        PositionTicks: 0,
        MediaSourceId: itemId,
        AudioStreamIndex: 0,
        SubtitleStreamIndex: -1,
        PlayMethod: "Transcode",
        IsDirectStream: false,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `VRChat Jellyfin/${process.env.npm_package_version || "1.0.0"}`,
        },
        body: JSON.stringify(playbackInfo),
      });

      if (response.status === 204 || response.status === 200) {
        console.log(`[CastClient] Playback started for item ${itemId}`);
      }
    } catch (err) {
      console.error("[CastClient] Error reporting playback start:", err);
    }
  }

  /**
   * Report playback progress
   */
  public async reportPlaybackProgress(
    itemId: string,
    hlsSessionId: string,
    positionSeconds: number,
    durationSeconds: number
  ): Promise<void> {
    try {
      const url = `${this.serverUrl}/Sessions/Me/Playing/Progress?api_key=${this.accessToken}`;

      const progressInfo = {
        ItemId: itemId,
        PlaySessionId: hlsSessionId,
        PositionTicks: Math.round(positionSeconds * 10_000_000), // Convert to Jellyfin ticks
        IsPaused: false,
      };

      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `VRChat Jellyfin/${process.env.npm_package_version || "1.0.0"}`,
        },
        body: JSON.stringify(progressInfo),
      });
    } catch (err) {
      console.error("[CastClient] Error reporting playback progress:", err);
    }
  }

  /**
   * Report playback stop
   */
  public async reportPlaybackStop(
    itemId: string,
    hlsSessionId: string,
    positionSeconds: number
  ): Promise<void> {
    try {
      const url = `${this.serverUrl}/Sessions/Me/Playing/Stopped?api_key=${this.accessToken}`;

      const stopInfo = {
        ItemId: itemId,
        PlaySessionId: hlsSessionId,
        PositionTicks: Math.round(positionSeconds * 10_000_000),
      };

      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `VRChat Jellyfin/${process.env.npm_package_version || "1.0.0"}`,
        },
        body: JSON.stringify(stopInfo),
      });

      console.log(`[CastClient] Playback stopped for item ${itemId}`);
    } catch (err) {
      console.error("[CastClient] Error reporting playback stop:", err);
    }
  }

  /**
   * Unregister device
   */
  public unregister(): void {
    if (this.registrationTimer) {
      clearInterval(this.registrationTimer);
      this.registrationTimer = null;
    }

    console.log(`[CastClient] Device unregistered: ${this.deviceId}`);
  }

  /**
   * Get device info
   */
  public getDeviceInfo(): CastDeviceInfo {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      appVersion: process.env.npm_package_version || "1.0.0",
      clientName: "VRChat Jellyfin",
      userId: this.userId,
      accessToken: this.accessToken,
    };
  }
}
