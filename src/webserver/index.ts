// src/webserver/index.ts

import express, { Request, Response } from "express";
import http from "http";
import ProxyManager from "../jellyfin/proxy/proxyManager";
import { client } from "../jellyfin";
import { ProxyOptions, SubtitleMethod } from "../jellyfin/proxy/proxy";
import { HLSManager } from "../hls/hlsManager";
import { SyncManager } from "../sync/syncManager";
import { CastManager } from "../jellyfin/cast/castManager";
import fs from "fs";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/assets", express.static("dist/client"));

// Serve the index.html file from the correct directory
app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "dist/client" });
});

// Status endpoint - always available
app.get("/api/status", (req: Request, res: Response) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        jellyfin: {
            connected: client.userId ? true : false,
            userId: client.userId || null,
            serverUrl: client.serverUrl,
        },
        features: {
            hls: true,
            sync: true,
            cast: CastManager.getAllCastClients().length > 0,
        },
        streams: {
            active: HLSManager.getActiveStreams().length,
        },
    });
});

// Endpoint to fetch playable media
app.get("/i", async (req, res) => {
    if (!client.userId) {
        res.status(503).json({ error: "Not connected to Jellyfin" });
        return;
    }
    const items = await client.getPlayableMedia();
    res.json(items);
});

// Endpoint to create a proxy with subtitle options
app.post("/i/:id", async (req, res) => {
    const itemId = req.params.id;
    const { subtitleStreamIndex } = req.body;

    const proxyOptions: ProxyOptions = {};

    if (subtitleStreamIndex != null) {
        proxyOptions.subtitleStreamIndex = subtitleStreamIndex;
        proxyOptions.subtitleMethod = SubtitleMethod.Encode;
    }

    const proxy = ProxyManager.createProxy(itemId, proxyOptions);
    res.json({
        id: proxy.id,
    });
});

// Endpoint to fetch subtitle streams
app.get("/subtitles/:itemId", async (req, res) => {
    if (!client.userId) {
        res.status(503).json({ error: "Not connected to Jellyfin" });
        return;
    }
    const itemId = req.params.itemId;
    try {
        const subtitleStreams = await client.getSubtitleStreams(itemId);
        res.json({ subtitleStreams });
    } catch (error) {
        console.error('Error fetching subtitle streams:', error);
        res.status(500).json({ error: 'Failed to fetch subtitle streams.' });
    }
});

// Endpoint to stream video with subtitle options
app.get("/v/:id", async (req, res) => {
    const proxy = ProxyManager.getProxy(req.params.id);

    if (!proxy) {
        res.status(404).send("Proxy not found, is your url valid?");
        return;
    }

    if (!client.userId) {
        res.status(503).send("Not connected to Jellyfin");
        return;
    }

    const itemId = proxy.itemId;
    const options = proxy.options;

    try {
        const response = await client.getVideoStream(itemId!, options);
        if (!response.ok || !response.body) {
            const errorText = await response.text();
            console.error(`Jellyfin stream fetch failed:`, {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                bodySnippet: errorText.slice(0, 200)
            });
            res.status(502).send("Failed to fetch video stream from Jellyfin.");
            return;
        }
        // Set headers from Jellyfin response
        for (const [key, value] of response.headers.entries()) {
            if (key.toLowerCase() === 'transfer-encoding') continue; // skip problematic headers
            res.setHeader(key, value);
        }
        response.body.pipe(res);
        console.log(`Piping stream to client with options:`, options);
    } catch (err) {
        console.error('Error in /v/:id route:', err);
        res.status(500).send('Internal server error while proxying video stream.');
    }
});

// ==================== HLS Endpoints ====================

/**
 * POST /hls/stream/:proxyId
 * Create an HLS stream from a video proxy
 * Returns: { sessionId, playlistUrl }
 */
app.post("/hls/stream/:proxyId", async (req: Request, res: Response) => {
    try {
        const proxy = ProxyManager.getProxy(req.params.proxyId);

        if (!proxy) {
            res.status(404).json({ error: "Proxy not found" });
            return;
        }

        if (!client.userId) {
            res.status(503).json({ error: "Not connected to Jellyfin" });
            return;
        }

        const itemId = proxy.itemId;
        const options = proxy.options;

        // Get video stream from Jellyfin
        const response = await client.getVideoStream(itemId!, options);
        if (!response.ok || !response.body) {
            res.status(502).json({ error: "Failed to fetch video stream from Jellyfin" });
            return;
        }

        // Create HLS stream from video stream
        const hlsSessionId = HLSManager.createStream(response.body as any);

        res.json({
            sessionId: hlsSessionId,
            playlistUrl: `/hls/playlist/${hlsSessionId}.m3u8`,
            itemId: itemId,
        });

        console.log(`[HLS] Stream created: ${hlsSessionId} for item ${itemId}`);
    } catch (err) {
        console.error("[HLS] Error creating stream:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /hls/playlist/:sessionId.m3u8
 * Get the HLS playlist
 */
app.get("/hls/playlist/:sessionId.m3u8", (req: Request, res: Response) => {
    const generator = HLSManager.getStream(req.params.sessionId);

    if (!generator) {
        res.status(404).send("Stream not found");
        return;
    }

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-cache");
    res.send(generator.getPlaylist());
});

/**
 * GET /hls/segment/:sessionId/:filename
 * Get a specific HLS segment
 */
app.get("/hls/segment/:sessionId/:filename", (req: Request, res: Response) => {
    const generator = HLSManager.getStream(req.params.sessionId);

    if (!generator) {
        res.status(404).send("Stream not found");
        return;
    }

    const segmentPath = generator.getSegmentFile(req.params.filename);

    if (!segmentPath || !fs.existsSync(segmentPath)) {
        res.status(404).send("Segment not found");
        return;
    }

    res.setHeader("Content-Type", "video/mp2t");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(segmentPath);
});

/**
 * GET /hls/status/:sessionId
 * Get HLS stream status
 */
app.get("/hls/status/:sessionId", (req: Request, res: Response) => {
    const generator = HLSManager.getStream(req.params.sessionId);

    if (!generator) {
        res.status(404).json({ error: "Stream not found" });
        return;
    }

    res.json(generator.getSessionInfo());
});

/**
 * DELETE /hls/stop/:sessionId
 * Stop and delete HLS stream
 */
app.delete("/hls/stop/:sessionId", (req: Request, res: Response) => {
    const stopped = HLSManager.stopStream(req.params.sessionId);

    if (stopped) {
        res.json({ message: "Stream stopped" });
    } else {
        res.status(404).json({ error: "Stream not found" });
    }
});

/**
 * GET /hls/streams
 * Get all active HLS streams
 */
app.get("/hls/streams", (req: Request, res: Response) => {
    res.json(HLSManager.getActiveStreams());
});

// ==================== Cast Endpoints ====================

/**
 * POST /cast/register/:itemId
 * Register playback of an item on the cast device
 */
app.post("/cast/register/:itemId", async (req: Request, res: Response) => {
    try {
        const itemId = req.params.itemId;
        const castClients = CastManager.getAllCastClients();

        if (castClients.length === 0) {
            res.status(503).json({ error: "No cast clients available" });
            return;
        }

        const castClient = castClients[0];
        const hlsSessionId = req.body.hlsSessionId || `hls-${Date.now()}`;

        // Report playback start to Jellyfin
        await castClient.reportPlaybackStart(itemId, hlsSessionId);

        res.json({
            message: "Playback registered",
            deviceId: castClient.getDeviceInfo().deviceId,
            hlsSessionId,
        });
    } catch (err) {
        console.error("[Cast] Error registering playback:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /cast/progress
 * Report playback progress
 */
app.post("/cast/progress", async (req: Request, res: Response) => {
    try {
        const { itemId, hlsSessionId, positionSeconds, durationSeconds } = req.body;

        const castClients = CastManager.getAllCastClients();
        if (castClients.length === 0) {
            res.status(503).json({ error: "No cast clients available" });
            return;
        }

        const castClient = castClients[0];
        await castClient.reportPlaybackProgress(
            itemId,
            hlsSessionId,
            positionSeconds,
            durationSeconds
        );

        res.json({ message: "Progress reported" });
    } catch (err) {
        console.error("[Cast] Error reporting progress:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /cast/stop
 * Report playback stop
 */
app.post("/cast/stop", async (req: Request, res: Response) => {
    try {
        const { itemId, hlsSessionId, positionSeconds } = req.body;

        const castClients = CastManager.getAllCastClients();
        if (castClients.length === 0) {
            res.status(503).json({ error: "No cast clients available" });
            return;
        }

        const castClient = castClients[0];
        await castClient.reportPlaybackStop(itemId, hlsSessionId, positionSeconds);

        res.json({ message: "Playback stopped" });
    } catch (err) {
        console.error("[Cast] Error stopping playback:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /cast/devices
 * Get all registered cast devices
 */
app.get("/cast/devices", (req: Request, res: Response) => {
    const devices = CastManager.getAllCastClients().map((c) =>
        c.getDeviceInfo()
    );
    res.json(devices);
});

// ==================== Sync Endpoints ====================

/**
 * GET /sync/sessions
 * Get all active sync sessions
 */
app.get("/sync/sessions", (req: Request, res: Response) => {
    res.json(SyncManager.getActiveSessions());
});

/**
 * GET /sync/session/:sessionId
 * Get state of a specific sync session
 */
app.get("/sync/session/:sessionId", (req: Request, res: Response) => {
    const state = SyncManager.getSessionState(req.params.sessionId);

    if (state) {
        res.json(state);
    } else {
        res.status(404).json({ error: "Session not found" });
    }
});

// ==================== Server Startup ====================

// Start the server after Jellyfin client authentication (or timeout)
let serverStarted = false;
const authPromise = client.authenticate()
    .then((success) => {
        if (success) {
            console.log("✓ Connected to Jellyfin");
        } else {
            console.warn("⚠ Failed to authenticate with Jellyfin");
            console.log("  Please verify: JELLYFIN_HOST, JELLYFIN_USERNAME, JELLYFIN_PASSWORD");
        }
        return success;
    })
    .catch((err) => {
        console.warn("⚠ Jellyfin connection error:", (err as Error).message);
        console.log("  Server will still function for HLS and WebSocket sync");
        return false;
    });

// Set timeout so server starts even if auth hangs
const serverStartTimeout = setTimeout(() => {
    if (!serverStarted) {
        console.warn("⚠ Jellyfin auth timeout - starting server anyway");
        startServer();
    }
}, 15000);

authPromise.finally(() => {
    clearTimeout(serverStartTimeout);
    if (!serverStarted) {
        startServer();
    }
});

function startServer() {
    if (serverStarted) return;
    serverStarted = true;

    const server = http.createServer(app);
    const port = parseInt(process.env.WEBSERVER_PORT || "4000");

    // Initialize HLS Manager
    HLSManager.init();

    // Initialize Sync Manager
    SyncManager.init(server);

    // Create cast device (optional, for Jellyfin integration)
    if (client.userId) {
        CastManager.createCastDevice(
            client.serverUrl,
            client.userId,
            client.apiKey,
            `VRChat Jellyfin Player (${process.env.INSTANCE_NAME || "default"})`
        ).catch((err) => {
            console.warn("[Cast] Could not initialize cast device:", (err as Error).message);
        });
    } else {
        console.log("[Cast] Skipped (not connected to Jellyfin)");
    }

    server.listen(port, () => {
        console.log(`✓ Webserver listening on port ${port}`);
        console.log(`  HLS streams: http://localhost:${port}/hls/`);
        console.log(`  WebSocket sync: ws://localhost:${port}/sync`);
        console.log(`  API status: http://localhost:${port}/api/status`);
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down gracefully...");
        HLSManager.shutdown();
        SyncManager.shutdown();
        CastManager.shutdown();
        server.close(() => {
            console.log("Server closed");
            process.exit(0);
        });
    });
}
