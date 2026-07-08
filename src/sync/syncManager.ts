// src/sync/syncManager.ts

import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { v4 as uuidv4 } from "uuid";

export interface PlaybackState {
  sessionId: string;
  itemId: string;
  playbackTime: number; // in seconds
  isPlaying: boolean;
  duration: number;
  clientId: string;
}

export interface SyncMessage {
  type: "sync" | "play" | "pause" | "seek" | "join" | "leave" | "heartbeat";
  payload: any;
}

export interface SyncClient {
  id: string;
  sessionId: string;
  lastHeartbeat: number;
  ws: WebSocket;
}

/**
 * Manages playback synchronization across multiple clients
 */
export class SyncManager {
  private static wss: WebSocketServer;
  private static clients: Map<string, SyncClient> = new Map();
  private static sessions: Map<
    string,
    { itemId: string; state: PlaybackState }
  > = new Map();
  private static heartbeatInterval: NodeJS.Timeout;
  private static readonly HEARTBEAT_TIMEOUT = 30000; // 30 seconds
  private static readonly SYNC_TOLERANCE = 2000; // 2 seconds tolerance

  /**
   * Initialize the Sync Manager with WebSocket server
   */
  static init(httpServer: Server): void {
    SyncManager.wss = new WebSocketServer({ server: httpServer, path: "/sync" });

    SyncManager.wss.on("connection", (ws: WebSocket) => {
      const clientId = uuidv4();
      console.log(`Client connected: ${clientId}`);

      ws.on("message", (data: string) => {
        try {
          const message: SyncMessage = JSON.parse(data);
          SyncManager.handleMessage(clientId, message, ws);
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      });

      ws.on("close", () => {
        SyncManager.handleClientDisconnect(clientId);
      });

      ws.on("error", (err) => {
        console.error(`WebSocket error for client ${clientId}:`, err);
      });

      // Send ready message
      ws.send(JSON.stringify({ type: "ready", clientId }));
    });

    // Heartbeat monitor
    SyncManager.heartbeatInterval = setInterval(() => {
      SyncManager.checkHeartbeats();
    }, 5000);

    console.log("Sync Manager initialized with WebSocket server");
  }

  /**
   * Handle incoming messages
   */
  private static handleMessage(
    clientId: string,
    message: SyncMessage,
    ws: WebSocket
  ): void {
    switch (message.type) {
      case "join": {
        const { sessionId, itemId } = message.payload;
        SyncManager.handleClientJoin(clientId, sessionId, itemId, ws);
        break;
      }
      case "sync": {
        const { sessionId, playbackTime, isPlaying, duration } =
          message.payload;
        SyncManager.handlePlaybackSync(clientId, sessionId, {
          sessionId,
          itemId: "",
          playbackTime,
          isPlaying,
          duration,
          clientId,
        });
        break;
      }
      case "play": {
        const { sessionId } = message.payload;
        SyncManager.broadcastToSession(sessionId, {
          type: "play",
          payload: { clientId },
        });
        break;
      }
      case "pause": {
        const { sessionId } = message.payload;
        SyncManager.broadcastToSession(sessionId, {
          type: "pause",
          payload: { clientId },
        });
        break;
      }
      case "seek": {
        const { sessionId, time } = message.payload;
        SyncManager.broadcastToSession(sessionId, {
          type: "seek",
          payload: { time, clientId },
        });
        break;
      }
      case "heartbeat": {
        const client = SyncManager.clients.get(clientId);
        if (client) {
          client.lastHeartbeat = Date.now();
        }
        break;
      }
    }
  }

  /**
   * Handle client join
   */
  private static handleClientJoin(
    clientId: string,
    sessionId: string,
    itemId: string,
    ws: WebSocket
  ): void {
    // Register client
    SyncManager.clients.set(clientId, {
      id: clientId,
      sessionId,
      lastHeartbeat: Date.now(),
      ws,
    });

    // Initialize session if not exists
    if (!SyncManager.sessions.has(sessionId)) {
      SyncManager.sessions.set(sessionId, {
        itemId,
        state: {
          sessionId,
          itemId,
          playbackTime: 0,
          isPlaying: false,
          duration: 0,
          clientId,
        },
      });
    }

    // Get current session state
    const session = SyncManager.sessions.get(sessionId);

    // Send join confirmation with current state
    ws.send(
      JSON.stringify({
        type: "joined",
        sessionId,
        state: session?.state,
        clients: SyncManager.getSessionClients(sessionId).map((c) => c.id),
      })
    );

    // Notify other clients
    SyncManager.broadcastToSession(sessionId, {
      type: "client_joined",
      payload: { clientId, totalClients: SyncManager.getSessionClients(sessionId).length },
    });

    console.log(
      `Client ${clientId} joined session ${sessionId}. Total clients: ${SyncManager.getSessionClients(sessionId).length}`
    );
  }

  /**
   * Handle playback synchronization
   */
  private static handlePlaybackSync(
    clientId: string,
    sessionId: string,
    state: PlaybackState
  ): void {
    const session = SyncManager.sessions.get(sessionId);
    if (!session) return;

    // Check if we need to sync
    const timeDiff = Math.abs(
      session.state.playbackTime - state.playbackTime
    );

    if (timeDiff > SyncManager.SYNC_TOLERANCE) {
      console.log(
        `Sync correction for session ${sessionId}: ${timeDiff.toFixed(2)}ms difference`
      );

      // Update session state
      session.state = state;

      // Broadcast corrected state to all other clients
      SyncManager.broadcastToSession(sessionId, {
        type: "sync_correction",
        payload: {
          playbackTime: state.playbackTime,
          isPlaying: state.isPlaying,
          correctedByClient: clientId,
        },
      });
    } else {
      // Update state without broadcast
      session.state = state;
    }
  }

  /**
   * Broadcast message to all clients in a session
   */
  private static broadcastToSession(sessionId: string, message: SyncMessage) {
    const sessionClients = SyncManager.getSessionClients(sessionId);

    for (const client of sessionClients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Get all clients in a session
   */
  private static getSessionClients(sessionId: string): SyncClient[] {
    return Array.from(SyncManager.clients.values()).filter(
      (c) => c.sessionId === sessionId
    );
  }

  /**
   * Handle client disconnect
   */
  private static handleClientDisconnect(clientId: string): void {
    const client = SyncManager.clients.get(clientId);
    if (client) {
      const sessionId = client.sessionId;
      SyncManager.clients.delete(clientId);

      // Notify remaining clients
      SyncManager.broadcastToSession(sessionId, {
        type: "client_left",
        payload: {
          clientId,
          totalClients: SyncManager.getSessionClients(sessionId).length,
        },
      });

      // Clean up empty sessions
      if (SyncManager.getSessionClients(sessionId).length === 0) {
        SyncManager.sessions.delete(sessionId);
        console.log(`Session ${sessionId} cleaned up (no clients)`);
      }
    }

    console.log(`Client ${clientId} disconnected`);
  }

  /**
   * Check for dead clients (heartbeat timeout)
   */
  private static checkHeartbeats(): void {
    const now = Date.now();

    for (const [clientId, client] of SyncManager.clients) {
      if (now - client.lastHeartbeat > SyncManager.HEARTBEAT_TIMEOUT) {
        console.log(
          `Client ${clientId} heartbeat timeout, disconnecting...`
        );
        client.ws.close();
      }
    }
  }

  /**
   * Get session state
   */
  static getSessionState(sessionId: string) {
    return SyncManager.sessions.get(sessionId)?.state;
  }

  /**
   * Get all active sessions
   */
  static getActiveSessions() {
    return Array.from(SyncManager.sessions.entries()).map(([id, session]) => ({
      sessionId: id,
      itemId: session.itemId,
      clientCount: SyncManager.getSessionClients(id).length,
      state: session.state,
    }));
  }

  /**
   * Shutdown Sync Manager
   */
  static shutdown(): void {
    if (SyncManager.heartbeatInterval) {
      clearInterval(SyncManager.heartbeatInterval);
    }

    for (const [, client] of SyncManager.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close();
      }
    }

    SyncManager.clients.clear();
    SyncManager.sessions.clear();

    if (SyncManager.wss) {
      SyncManager.wss.close();
    }

    console.log("Sync Manager shut down");
  }
}
