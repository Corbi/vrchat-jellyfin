// src/jellyfin/cast/castManager.ts

import { JellyfinCastClient } from "./castClient";

/**
 * Manages Jellyfin cast clients/devices
 */
export class CastManager {
  private static castClients: Map<string, JellyfinCastClient> = new Map();

  /**
   * Create and register a new cast device
   */
  static async createCastDevice(
    serverUrl: string,
    userId: string,
    accessToken: string,
    deviceName?: string
  ): Promise<JellyfinCastClient | null> {
    try {
      const castClient = new JellyfinCastClient(
        serverUrl,
        userId,
        accessToken,
        deviceName
      );

      const registered = await castClient.register();

      if (registered) {
        const deviceInfo = castClient.getDeviceInfo();
        CastManager.castClients.set(deviceInfo.deviceId, castClient);
        console.log(`[CastManager] Cast device registered successfully`);
        return castClient;
      }

      console.warn("[CastManager] Cast device initialization failed");
      return null;
    } catch (err) {
      console.error("[CastManager] Error creating cast device:", err);
      throw err;
    }
  }

  /**
   * Get a cast client by device ID
   */
  static getCastClient(deviceId: string): JellyfinCastClient | undefined {
    return CastManager.castClients.get(deviceId);
  }

  /**
   * Get all cast clients
   */
  static getAllCastClients(): JellyfinCastClient[] {
    return Array.from(CastManager.castClients.values());
  }

  /**
   * Remove a cast client
   */
  static removeCastClient(deviceId: string): boolean {
    const castClient = CastManager.castClients.get(deviceId);
    if (castClient) {
      castClient.unregister();
      CastManager.castClients.delete(deviceId);
      return true;
    }
    return false;
  }

  /**
   * Shutdown all cast clients
   */
  static shutdown(): void {
    for (const [, castClient] of CastManager.castClients) {
      castClient.unregister();
    }
    CastManager.castClients.clear();
    console.log("[CastManager] All cast clients shut down");
  }
}
