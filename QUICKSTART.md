# Quick Start - VRChat Jellyfin with HLS, Cast & Sync

## Prerequisites

- Node.js 16+ and npm
- FFmpeg and FFprobe installed
- Jellyfin server (with API access)
- VRChat world (for sync testing)

## Installation

### 1. Install FFmpeg (if not already installed)

**macOS:**
```bash
brew install ffmpeg ffprobe
```

**Ubuntu/Debian:**
```bash
sudo apt-get install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html

### 2. Clone and Setup Project

```bash
git clone https://github.com/orcachillin/vrchat-jellyfin
cd vrchat-jellyfin
npm install
```

### 3. Configure Environment

Copy and edit `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your Jellyfin details:

```env
JELLYFIN_HOST=https://jellyfin.example.com
JELLYFIN_USERNAME=your-username
JELLYFIN_PASSWORD=your-password
WEBSERVER_PORT=4000

# Optional: Instance name shown in Jellyfin UI
INSTANCE_NAME=My VRChat Instance

# Video encoding (adjust for your network)
VIDEO_BITRATE=3000000    # 3 Mbps
AUDIO_BITRATE=128000     # 128 kbps
MAX_HEIGHT=720
MAX_WIDTH=1280
MAX_AUDIO_CHANNELS=2
```

## Building

```bash
npm run build
```

This compiles TypeScript and builds the Vite frontend.

## Running

### Development (with hot reload)

```bash
npm start
```

The server will start on `http://localhost:4000`

### Check it's working

```bash
# Test that the cast device is registered
curl http://localhost:4000/cast/devices

# Check active HLS streams
curl http://localhost:4000/hls/streams

# Check active sync sessions
curl http://localhost:4000/sync/sessions
```

## Using the Features

### 1. Create a Stream

```bash
# First, create a proxy for a Jellyfin item
curl -X POST http://localhost:4000/i/item-id \
  -H "Content-Type: application/json" \
  -d '{}'
# Returns: { "id": "proxy-123" }

# Then create HLS stream
curl -X POST http://localhost:4000/hls/stream/proxy-123
# Returns: { "sessionId": "uuid", "playlistUrl": "/hls/playlist/uuid.m3u8" }
```

### 2. Play in VRChat

Use this URL in a video player in VRChat:
```
http://your-server:4000/hls/playlist/uuid.m3u8
```

The device will also appear in Jellyfin UI as a casteable device.

### 3. Synchronize Playback

In your VRChat world, use the sync client:

```typescript
import VRChatSyncClient from './sync-client';

const syncClient = new VRChatSyncClient('http://your-server:4000');
await syncClient.connect();
syncClient.joinSession('session-id', 'item-id');

// Send playback state every second
syncClient.startAutoSync(() => ({
  time: videoPlayer.currentTime,
  isPlaying: !videoPlayer.paused,
  duration: videoPlayer.duration,
}));
```

## Folder Structure

```
src/
├── hls/                 # HLS segment generation
│   ├── hlsGenerator.ts  # FFmpeg → HLS conversion
│   ├── hlsManager.ts    # Multi-stream management
│   └── index.ts
├── jellyfin/
│   ├── cast/            # Jellyfin cast device
│   │   ├── castClient.ts      # Device registration
│   │   ├── castManager.ts     # Device lifecycle
│   │   └── index.ts
│   ├── proxy/           # (existing) URL proxy
│   ├── client.ts        # Jellyfin API client
│   └── index.ts
├── sync/                # Playback synchronization
│   ├── syncManager.ts   # Server-side (WebSocket)
│   └── index.ts
└── webserver/           # Express server + routes

client/
├── sync-client.ts       # Client-side sync library
├── client.ts            # Frontend code
└── types.ts
```

## Docker

To run with Docker:

```bash
docker-compose up -d
```

Logs:
```bash
docker-compose logs -f vrchat-jellyfin
```

## Monitoring

### Check active streams
```bash
curl http://localhost:4000/hls/streams | jq
```

### Check sync sessions
```bash
curl http://localhost:4000/sync/sessions | jq
```

### Check cast devices
```bash
curl http://localhost:4000/cast/devices | jq
```

## Troubleshooting

### FFmpeg not found
```bash
which ffmpeg
# If empty, install it (see Prerequisites section)
```

### Port already in use
Change in `.env`:
```env
WEBSERVER_PORT=5000
```

### WebSocket connection failed
Check firewall allows WebSocket on the port. Also verify:
```bash
curl http://localhost:4000/sync/sessions
# Should return []
```

### Jellyfin device not showing
1. Check logs: `npm start` output
2. Verify Jellyfin credentials in `.env`
3. Ensure Jellyfin API key is valid

## Documentation

- [HLS/Cast/Sync Implementation Guide](./HLS_CAST_SYNC_GUIDE.md) - Full API reference
- [Original README](./README.md) - VRChat/Jellyfin setup

## Performance Tips

- **Lower latency**: Reduce `HLS_SEGMENT_DURATION` from 2s to 1s
- **Lower bandwidth**: Decrease `VIDEO_BITRATE`
- **Better quality**: Increase `VIDEO_BITRATE` and `MAX_HEIGHT`
- **Reduce CPU**: Disable subtitle encoding if not needed

## Next Steps

1. Start the server: `npm start`
2. Verify it works: `curl http://localhost:4000/cast/devices`
3. Create a proxy and stream: See "Using the Features" above
4. Integrate sync into your VRChat world (advanced)

Need help? Check the full [HLS_CAST_SYNC_GUIDE.md](./HLS_CAST_SYNC_GUIDE.md)
