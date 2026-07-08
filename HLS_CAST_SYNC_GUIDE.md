# HLS, Cast & Sync Implementation Guide

This document explains how to use the new HLS streaming, Jellyfin casting, and playback synchronization features.

## Architecture Overview

The implementation consists of three main components:

### 1. **HLS Streaming** (`src/hls/`)
Converts video streams from Jellyfin into HTTP Live Streaming (HLS) format with `.m3u8` playlists and `.ts` segments.

- `hlsGenerator.ts` - Generates HLS segments from a video stream
- `hlsManager.ts` - Manages multiple active HLS streams

### 2. **Cast Integration** (`src/jellyfin/cast/`)
Registers the server as a casteable device in Jellyfin, allowing you to cast to it from the Jellyfin UI.

- `castClient.ts` - Handles device registration and playback reporting
- `castManager.ts` - Manages cast devices

### 3. **Playback Sync** (`src/sync/`)
Uses WebSocket to synchronize playback state across multiple clients in VRChat.

- `syncManager.ts` - Server-side sync coordinator
- `sync-client.ts` - Client-side sync for VRChat worlds

## Workflow

### Step 1: Create a Proxy
First, create a proxy for your video item (existing endpoint):

```bash
curl -X POST http://localhost:4000/i/:itemId \
  -H "Content-Type: application/json" \
  -d '{"subtitleStreamIndex": null}'
# Response: { "id": "proxy123" }
```

### Step 2: Create HLS Stream
Convert the proxied video to HLS:

```bash
curl -X POST http://localhost:4000/hls/stream/proxy123
# Response:
# {
#   "sessionId": "550e8400-e29b-41d4-a716-446655440000",
#   "playlistUrl": "/hls/playlist/550e8400-e29b-41d4-a716-446655440000.m3u8",
#   "itemId": "item123"
# }
```

### Step 3: Play in VRChat
Use the HLS playlist URL in a video player:

```
http://your-server:4000/hls/playlist/550e8400-e29b-41d4-a716-446655440000.m3u8
```

### Step 4: Sync Playback (Optional)
Connect to WebSocket to sync playback across all clients:

```typescript
import VRChatSyncClient from './sync-client';

const syncClient = new VRChatSyncClient('http://localhost:4000');

// Connect to sync server
await syncClient.connect();

// Join a session
syncClient.joinSession('session-id', 'item-id');

// Register events
syncClient.on('syncCorrection', (state) => {
  // Seek to corrected time
  videoPlayer.currentTime = state.playbackTime;
});

// Start auto-sync (sends playback state every second)
syncClient.startAutoSync(() => ({
  time: videoPlayer.currentTime,
  isPlaying: !videoPlayer.paused,
  duration: videoPlayer.duration,
}));
```

## API Endpoints

### HLS Endpoints

#### `POST /hls/stream/:proxyId`
Create an HLS stream from a proxied video.

**Response:**
```json
{
  "sessionId": "uuid",
  "playlistUrl": "/hls/playlist/uuid.m3u8",
  "itemId": "item-id"
}
```

#### `GET /hls/playlist/:sessionId.m3u8`
Get the HLS playlist (M3U8 format).

#### `GET /hls/segment/:sessionId/:filename`
Get a specific HLS segment (TS file).

#### `GET /hls/status/:sessionId`
Get stream status and segment information.

#### `DELETE /hls/stop/:sessionId`
Stop and delete an HLS stream.

#### `GET /hls/streams`
Get all active HLS streams.

### Cast Endpoints

#### `POST /cast/register/:itemId`
Register playback on Jellyfin. The device becomes visible in Jellyfin UI.

**Body:**
```json
{
  "hlsSessionId": "hls-session-id"
}
```

#### `POST /cast/progress`
Report playback progress to Jellyfin.

**Body:**
```json
{
  "itemId": "item-id",
  "hlsSessionId": "hls-session-id",
  "positionSeconds": 45.5,
  "durationSeconds": 120
}
```

#### `POST /cast/stop`
Report playback stop.

**Body:**
```json
{
  "itemId": "item-id",
  "hlsSessionId": "hls-session-id",
  "positionSeconds": 45.5
}
```

#### `GET /cast/devices`
Get all registered cast devices.

### Sync Endpoints

#### `GET /sync/sessions`
Get all active sync sessions.

#### `GET /sync/session/:sessionId`
Get state of a specific sync session.

#### WebSocket: `WS /sync`
Connect to the real-time sync server.

**Messages:**

- `join` - Join a sync session
- `sync` - Send playback state
- `play` - Broadcast play command
- `pause` - Broadcast pause command
- `seek` - Broadcast seek command
- `heartbeat` - Keep-alive ping

## Environment Variables

Add these to your `.env`:

```env
# Existing
JELLYFIN_HOST=https://jellyfin.example.com
JELLYFIN_USERNAME=user
JELLYFIN_PASSWORD=password
WEBSERVER_PORT=4000

# New (optional)
INSTANCE_NAME=Living Room  # Used in cast device name
AUDIO_BITRATE=128000
VIDEO_BITRATE=3000000
MAX_AUDIO_CHANNELS=2
MAX_HEIGHT=720
MAX_WIDTH=1280
```

## VRChat Implementation Example

Here's how you might implement this in a VRChat world:

```csharp
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

public class JellyfinStreamPlayer : UdonSharpBehaviour
{
    public VideoPlayer videoPlayer;
    public string syncServerUrl = "http://localhost:4000";
    private string hlsSessionId;
    private string syncSessionId;
    
    public void PlayMedia(string proxyId, string itemId)
    {
        // 1. Get HLS URL from proxy
        StartCoroutine(CreateHLSStream(proxyId, itemId));
    }
    
    private IEnumerator CreateHLSStream(string proxyId, string itemId)
    {
        string url = $"{syncServerUrl}/hls/stream/{proxyId}";
        using (UnityWebRequest www = UnityWebRequest.Post(url, ""))
        {
            yield return www.SendWebRequest();
            
            if (www.result == UnityWebRequest.Result.Success)
            {
                // Parse response to get playlist URL
                // Start playing HLS stream
                videoPlayer.url = $"{syncServerUrl}/hls/playlist/{hlsSessionId}.m3u8";
                
                // Connect to sync
                ConnectToSync(syncSessionId, itemId);
            }
        }
    }
    
    private void ConnectToSync(string sessionId, string itemId)
    {
        // Use sync-client to synchronize playback
        // This ensures all players see the same video at the same time
    }
}
```

## Performance Considerations

1. **Segment Duration**: Default 2 seconds. Adjust in `hlsGenerator.ts` for latency/buffering tradeoff.
2. **Max Segments**: Keeps 10 segments in buffer. Configurable in `hlsGenerator.ts`.
3. **Sync Tolerance**: 2 seconds by default. Configurable in `syncManager.ts`.
4. **WebSocket Heartbeat**: 30 seconds. Adjust `HEARTBEAT_TIMEOUT` for network conditions.

## Troubleshooting

### HLS Stream not working
1. Check FFmpeg installation: `ffmpeg -version`
2. Verify video codec support in VRChat player
3. Check segment directory permissions: `hls_segments/`

### Cast device not showing in Jellyfin UI
1. Check Jellyfin logs for device registration errors
2. Ensure API key is valid
3. Try manually registering: `POST /cast/register/{itemId}`

### Playback out of sync
1. Reduce `SYNC_TOLERANCE` in `syncManager.ts`
2. Ensure stable network connection
3. Check WebSocket connection status

### FFmpeg process hangs
1. Check available disk space for segments
2. Monitor CPU usage
3. Set reasonable bitrate limits
