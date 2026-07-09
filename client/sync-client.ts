// client/sync-client.ts

/**
 * VRChat Sync Client - Handles playback synchronization
 * Used in VRChat world to sync playback across all players
 */

export interface PlaybackState {
  sessionId: string;
  itemId: string;
  time: number; // Add 'time' property
  playbackTime: number; // Add 'playbackTime' property
  isPlaying: boolean;
  duration: number;
  clientId: string;
}

export class VRChatSyncClient {
  private ws: WebSocket | null = null;
  private clientId: string = "";
  private sessionId: string = "";
  private currentState: PlaybackState | null = null;
  private syncInterval: number | null = null;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly RECONNECT_DELAY = 3000; // 3 seconds
  private readonly SYNC_INTERVAL = 1000; // 1 second

  private eventCallbacks: {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onStateUpdate?: (state: PlaybackState) => void;
    onSyncCorrection?: (state: PlaybackState) => void;
    onClientJoined?: (clientId: string, totalClients: number) => void;
    onClientLeft?: (clientId: string, totalClients: number) => void;
    onError?: (error: string) => void;
  } = {};

  constructor(private serverUrl: string) {}

  /**
   * Connect to the sync server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/sync`;
        console.log(`[SyncClient] Connecting to ${wsUrl}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("[SyncClient] Connected to sync server");
          this.reconnectAttempts = 0;
          this.eventCallbacks.onConnected?.();
          resolve();
        };

        this.ws.onmessage = (event) => this.handleMessage(event.data);
        this.ws.onclose = () => this.handleDisconnect();
        this.ws.onerror = (error) => {
          console.error("[SyncClient] WebSocket error:", error);
          this.eventCallbacks.onError?.(
            `WebSocket error: ${error}`
          );
          reject(error);
        };
      } catch (error) {
        console.error("[SyncClient] Connection error:", error);
        reject(error);
      }
    });
  }

  /**
   * Join a playback session
   */
  public joinSession(sessionId: string, itemId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[SyncClient] Not connected to sync server");
      return;
    }

    this.sessionId = sessionId;
    this.send({
      type: "join",
      payload: { sessionId, itemId },
    });

    console.log(`[SyncClient] Joining session ${sessionId}`);
  }

  /**
   * Report current playback state
   */
  public syncPlaybackState(
    playbackTime: number,
    isPlaying: boolean,
    duration: number
  ): void {
    if (!this.sessionId) {
      console.warn("[SyncClient] No active session");
      return;
    }

      this.currentState = {
        sessionId: this.sessionId,
        itemId: "",
        time: playbackTime, // Update 'time' property
        playbackTime,
        isPlaying,
        duration,
        clientId: this.clientId,
      };

    this.send({
      type: "sync",
      payload: {
        sessionId: this.sessionId,
        playbackTime,
        isPlaying,
        duration,
      },
    });
  }

  /**
   * Send play command
   */
  public play(): void {
    this.send({
      type: "play",
      payload: { sessionId: this.sessionId },
    });
  }

  /**
   * Send pause command
   */
  public pause(): void {
    this.send({
      type: "pause",
      payload: { sessionId: this.sessionId },
    });
    if (this.currentState) {
      this.currentState.isPlaying = false;
      this.eventCallbacks.onStateUpdate?.(this.currentState);
    }
  }

  /**
   * Send seek command
   */
  public seek(positionSeconds: number): void {
    this.send({
      type: "seek",
      payload: { sessionId: this.sessionId, time: positionSeconds },
    });
  }

  /**
   * Send heartbeat to keep connection alive
   */
  public heartbeat(): void {
    this.send({
      type: "heartbeat",
      payload: {},
    });
  }

  /**
   * Start periodic synchronization
   */
public startAutoSync(
  getPlaybackState: () => PlaybackState
): void {
    if (this.syncInterval !== null) {
      return;
    }

    // Send sync every second
    this.syncInterval = window.setInterval(() => {
      const state = getPlaybackState();
      this.syncPlaybackState(state.time, state.isPlaying, state.duration);

      // Heartbeat every 10 syncs
      if (Math.random() < 0.1) {
        this.heartbeat();
      }
    }, this.SYNC_INTERVAL);

    console.log("[SyncClient] Auto-sync started");
  }

  /**
   * Stop periodic synchronization
   */
  public stopAutoSync(): void {
    if (this.syncInterval !== null) {
      window.clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log("[SyncClient] Auto-sync stopped");
    }
  }

  /**
   * Set event callback
   */
  public on(
    event:
      | "connected"
      | "disconnected"
      | "stateUpdate"
      | "syncCorrection"
      | "clientJoined"
      | "clientLeft"
      | "error",
    callback: Function
  ): void {
    switch (event) {
      case "connected":
        this.eventCallbacks.onConnected = callback as () => void;
        break;
      case "disconnected":
        this.eventCallbacks.onDisconnected = callback as () => void;
        break;
      case "stateUpdate":
        this.eventCallbacks.onStateUpdate = callback as (
          state: PlaybackState
        ) => void;
        break;
      case "syncCorrection":
        this.eventCallbacks.onSyncCorrection = callback as (
          state: PlaybackState
        ) => void;
        break;
      case "clientJoined":
        this.eventCallbacks.onClientJoined = callback as (
          clientId: string,
          totalClients: number
        ) => void;
        break;
      case "clientLeft":
        this.eventCallbacks.onClientLeft = callback as (
          clientId: string,
          totalClients: number
        ) => void;
        break;
      case "error":
        this.eventCallbacks.onError = callback as (error: string) => void;
        break;
    }
  }

  /**
   * Disconnect from sync server
   */
  public disconnect(): void {
    this.stopAutoSync();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = "";
    console.log("[SyncClient] Disconnected");
  }

  // ==================== Private Methods ====================

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "ready":
          this.clientId = message.clientId;
          console.log(`[SyncClient] Ready with clientId: ${this.clientId}`);
          break;

        case "joined":
          console.log(`[SyncClient] Joined session ${message.sessionId}`);
          if (message.state) {
            this.currentState = message.state;
            this.eventCallbacks.onStateUpdate?.(message.state);
          }
          break;

        case "sync_correction":
          console.log(
            `[SyncClient] Sync correction received: ${message.payload.playbackTime.toFixed(2)}s`
          );
            if (this.currentState) {
              this.currentState.time = message.payload.playbackTime; // Update 'time' property
              this.currentState.playbackTime = message.payload.playbackTime;
              this.currentState.isPlaying = message.payload.isPlaying;
              this.eventCallbacks.onSyncCorrection?.(this.currentState);
            }
          break;

        case "client_joined":
          console.log(
            `[SyncClient] Client joined. Total: ${message.payload.totalClients}`
          );
          this.eventCallbacks.onClientJoined?.(
            message.payload.clientId,
            message.payload.totalClients
          );
          break;

        case "client_left":
          console.log(
            `[SyncClient] Client left. Total: ${message.payload.totalClients}`
          );
          this.eventCallbacks.onClientLeft?.(
            message.payload.clientId,
            message.payload.totalClients
          );
          break;

        case "play":
          console.log(`[SyncClient] Play command received`);
          break;

        case "pause":
          console.log(`[SyncClient] Pause command received`);
          break;

        case "seek":
          console.log(
            `[SyncClient] Seek command received: ${message.payload.time.toFixed(2)}s`
          );
          break;
      }
    } catch (error) {
      console.error("[SyncClient] Error handling message:", error);
    }
  }

  private handleDisconnect(): void {
    console.log("[SyncClient] Disconnected from sync server");
    this.stopAutoSync();
    this.eventCallbacks.onDisconnected?.();

    // Attempt to reconnect
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      console.log(
        `[SyncClient] Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`
      );

      setTimeout(() => {
        this.connect().catch((err) => {
          console.error("[SyncClient] Reconnection failed:", err);
        });
      }, this.RECONNECT_DELAY);
    } else {
      console.error(
        "[SyncClient] Max reconnection attempts reached, giving up"
      );
    }
  }

  private send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[SyncClient] WebSocket not connected");
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Get current client info
   */
  public getClientInfo() {
    return {
      clientId: this.clientId,
      sessionId: this.sessionId,
      isConnected: this.ws?.readyState === WebSocket.OPEN,
      currentState: this.currentState,
    };
  }
}

export default VRChatSyncClient;