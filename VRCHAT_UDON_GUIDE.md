# VRChat Udon Integration Example

This shows how to integrate the Jellyfin streaming and sync system into a VRChat world.

## Simple Stream Player Setup

### 1. Basic Video Player (No Sync)

Create an empty GameObject with this script:

```csharp
using UdonSharp;
using UnityEngine;
using VRC.SDK3.Components.Video;
using VRC.SDKBase;
using VRC.Udon;

public class JellyfinPlayer : UdonSharpBehaviour
{
    [SerializeField] private VRCUnityVideoPlayer videoPlayer;
    private string jellyfinServerUrl = "http://your-server:4000";
    private string currentItemId;
    private string currentProxyId;
    
    // Use this to start playing a video
    public void PlayItem(string itemId)
    {
        currentItemId = itemId;
        
        // In a real scenario, you'd first create a proxy via HTTP
        // For now, assume proxy exists
        CreateHLSStream("proxy-id-from-jellyfin");
    }
    
    private void CreateHLSStream(string proxyId)
    {
        // Build URL for HLS stream endpoint
        string url = $"{jellyfinServerUrl}/hls/stream/{proxyId}";
        
        // In Udon, you'd typically use VRC.Core networking to call this
        // For a web implementation, use VRCUrlInputField or similar
        
        // Example HLS URL format (based on API response)
        string hlsUrl = $"{jellyfinServerUrl}/hls/playlist/550e8400-e29b-41d4-a716-446655440000.m3u8";
        
        // Play the HLS stream
        videoPlayer.PlayURL(VRCUrl.FromString(hlsUrl));
    }
}
```

## Advanced Setup with Sync

For synchronized playback, you'll need:

### 1. Create a Sync Manager Prefab

```csharp
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;

public class JellyfinSyncManager : UdonSharpBehaviour
{
    [SerializeField] private VRCUnityVideoPlayer videoPlayer;
    [SerializeField] private string syncServerUrl = "http://your-server:4000";
    
    private string currentSessionId;
    private string currentItemId;
    private float lastSyncTime = 0f;
    private float syncInterval = 1f; // Sync every second
    
    private void Update()
    {
        if (string.IsNullOrEmpty(currentSessionId)) return;
        
        lastSyncTime += Time.deltaTime;
        if (lastSyncTime >= syncInterval)
        {
            SendPlaybackState();
            lastSyncTime = 0f;
        }
    }
    
    public void JoinSyncSession(string sessionId, string itemId)
    {
        currentSessionId = sessionId;
        currentItemId = itemId;
        
        // In a real implementation, you'd send a WebSocket message:
        // {
        //   "type": "join",
        //   "payload": { "sessionId": sessionId, "itemId": itemId }
        // }
        
        Debug.Log($"Joined sync session: {sessionId}");
    }
    
    private void SendPlaybackState()
    {
        if (videoPlayer == null) return;
        
        float currentTime = (float)videoPlayer.GetTime();
        float duration = (float)videoPlayer.GetDuration();
        
        // Send sync message (WebSocket in real implementation):
        // {
        //   "type": "sync",
        //   "payload": {
        //     "sessionId": currentSessionId,
        //     "playbackTime": currentTime,
        //     "isPlaying": !videoPlayer.IsPlaying,
        //     "duration": duration
        //   }
        // }
        
        Debug.Log($"Sync: {currentTime:F2}s / {duration:F2}s");
    }
    
    public void OnSyncCorrectionReceived(float correctedTime)
    {
        // Called when server sends sync correction
        videoPlayer.SetTime(correctedTime);
        Debug.Log($"Sync corrected to: {correctedTime:F2}s");
    }
}
```

### 2. Jellyfin Menu UI

```csharp
using UdonSharp;
using UnityEngine;
using UnityEngine.UI;
using VRC.SDKBase;

public class JellyfinMenuUI : UdonSharpBehaviour
{
    [SerializeField] private Button playButton;
    [SerializeField] private InputField urlInputField;
    [SerializeField] private Text statusText;
    [SerializeField] private JellyfinPlayer jellyfinPlayer;
    [SerializeField] private JellyfinSyncManager syncManager;
    
    private void Start()
    {
        playButton.onClick.AddListener(OnPlayClick);
    }
    
    private void OnPlayClick()
    {
        string url = urlInputField.text;
        
        if (string.IsNullOrEmpty(url))
        {
            statusText.text = "Please enter a URL";
            return;
        }
        
        // Example format: http://server:4000/hls/playlist/uuid.m3u8
        statusText.text = "Playing...";
        
        // Extract session ID from URL if needed
        // string sessionId = ExtractSessionIdFromUrl(url);
        // syncManager.JoinSyncSession(sessionId, "item-id");
        
        jellyfinPlayer.PlayItem("item-id");
    }
}
```

### 3. Network-Synced Playback

For true VRChat network synchronization:

```csharp
using UdonSharp;
using UnityEngine;
using VRC.SDKBase;
using VRC.Udon.Common.Interfaces;

public class NetworkVideoSync : UdonSharpBehaviour
{
    [SerializeField] private VRCUnityVideoPlayer videoPlayer;
    private VRCPlayerApi owningPlayer;
    private float lastBroadcastTime;
    private float broadcastInterval = 2f; // Sync every 2 seconds
    
    public void PlayVideo(string url)
    {
        videoPlayer.PlayURL(VRCUrl.FromString(url));
        RequestSerialization();
    }
    
    public override void OnVideoReady()
    {
        Debug.Log("Video ready");
        RequestSerialization();
    }
    
    public override void OnVideoStart()
    {
        Debug.Log("Video started");
        RequestSerialization();
    }
    
    private void Update()
    {
        if (!videoPlayer.IsReady) return;
        
        lastBroadcastTime += Time.deltaTime;
        if (lastBroadcastTime >= broadcastInterval)
        {
            RequestSerialization();
            lastBroadcastTime = 0f;
        }
    }
    
    public override void OnDeserialization()
    {
        // Called when network state is received from other players
        // Automatically keeps videoPlayer in sync
    }
}
```

## HTTP Request Helper

To make HTTP requests from Udon, you can use a helper object:

```csharp
using UdonSharp;
using UnityEngine;
using VRC.Core;

public class JellyfinHTTPHelper : UdonSharpBehaviour
{
    // Note: VRChat SDK has limited HTTP support
    // For production, consider using a separate relay server or
    // hardcoding URLs generated server-side
    
    public void GetPlaylistUrl(string proxyId, System.Action<string> callback)
    {
        // Example: You would typically:
        // 1. Pre-generate HLS URLs on the server
        // 2. Store them in a config
        // 3. Load them into Udon
        
        string hlsUrl = $"http://server:4000/hls/playlist/{proxyId}.m3u8";
        callback?.Invoke(hlsUrl);
    }
}
```

## Setup Instructions

### 1. Create the Scene Hierarchy

```
JellyfinManager (Empty)
├── VideoPlayer (VRCUnityVideoPlayer)
├── SyncManager (JellyfinSyncManager script)
├── Player (JellyfinPlayer script)
└── UI (Canvas)
    ├── Button "Play"
    ├── InputField "URL"
    └── Text "Status"
```

### 2. Assign References

- Drag VideoPlayer to the script's videoPlayer field
- Assign Button, InputField, Text in the UI script
- Link scripts together

### 3. Configure Server URL

In each script, set:
```csharp
syncServerUrl = "http://your-server-ip:4000"
```

### 4. Test

1. Start the VRChat world
2. Enter your Jellyfin server URL
3. Press Play
4. Video should start playing synchronized across all players

## WebSocket Integration (Advanced)

For full real-time sync without polling:

1. Use a Udon network prefab to handle sync messages
2. Create a relay service to translate WebSocket messages to VRChat network events
3. Or: Pre-compute and embed all sync data server-side

## Important Notes

- **VRChat Limitations**: Limited HTTP support. Consider pre-generating URLs server-side
- **Latency**: Network sync has ~500ms-2s latency. Use audioSyncMode = Disabled in videoPlayer
- **Security**: Only share HLS URLs, never API keys
- **Testing**: Test locally with `localhost:4000` first
- **CORS**: Configure server CORS if accessing from different domain

## Troubleshooting

### Video not playing
- Check URL is correct: `http://server:4000/hls/playlist/uuid.m3u8`
- Verify server is running: `curl http://server:4000/hls/streams`
- Check VRChat network permissions

### Out of sync
- Increase `broadcastInterval` for less frequent syncing
- Disable audio sync in VRCUnityVideoPlayer
- Use manual seek commands instead of automatic sync

### Server not accessible
- Check firewall allows traffic on port 4000
- Verify URL uses correct IP/hostname
- Test with `curl` from a PC in the world

## Example Complete Scene

See the [examples/](./examples/) folder for a complete working example:
- `JellyfinWorld.unitypackage` - Full scene setup
- `Scripts/` - All required scripts
- `Prefabs/` - Ready-to-use prefabs

To use:
1. Download the example
2. Import into your VRChat project
3. Configure server URL
4. Test in-world
