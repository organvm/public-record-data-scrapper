# 🎬 Quick Video Reference

## Generated Video

**File**: `video-output/EXECUTIVE_VIDEO_SCRIPT.mp4`  
**Duration**: 5 minutes 39 seconds  
**Size**: 4.1 MB  
**Format**: 1920x1080 MP4 (H.264 + AAC)  
**Audio**: TTS narration (espeak)

## Quick Commands

### Generate Video
```bash
npm run video:generate
```

### Validate Setup
```bash
npm run video:validate
```

### Install Dependencies (First Time)
```bash
# Linux
sudo apt-get update
sudo apt-get install -y ffmpeg espeak

# macOS
brew install ffmpeg
# 'say' is built-in on macOS
```

### Custom Generation
```bash
# 4K video at 60 FPS
./scripts/video-production/generate-videos.sh \
  --resolution 3840x2160 \
  --fps 60

# Different script
./scripts/video-production/generate-videos.sh \
  --pattern "DEMO_VIDEO_SCRIPT.md"
```

## Video Content (9 Sections)

1. **Executive Hook** (0:00-0:30) - Problem introduction
2. **Problem Landscape** (0:30-1:15) - Industry pain points
3. **The Insight** (1:15-2:00) - Strategic approach
4. **Solution Architecture** (2:00-3:00) - Three-tier system
5. **Technical Sophistication** (3:00-3:30) - Quality & reliability
6. **Business Impact** (3:30-4:00) - Measurable results
7. **Differentiators** (4:00-4:30) - Unique value
8. **Why This Person** (4:30-4:50) - Personal positioning
9. **Call to Action** (4:50-5:00) - Next steps

## Sharing Options

### Upload to YouTube
1. Go to youtube.com/upload
2. Upload `video-output/EXECUTIVE_VIDEO_SCRIPT.mp4`
3. Add title, description, tags
4. Set visibility (Public/Unlisted/Private)

### Share on LinkedIn
1. Create a new post
2. Click video icon
3. Upload `video-output/EXECUTIVE_VIDEO_SCRIPT.mp4`
4. Add context in post text
5. Tag relevant connections

### Email/Direct Share
- File size is only 4.1 MB
- Can be attached directly to emails
- Or upload to Google Drive/Dropbox and share link

## Customization

### Edit the Script
```bash
# Edit the markdown script
nano docs/video-portfolio/EXECUTIVE_VIDEO_SCRIPT.md

# Regenerate video
npm run video:generate
```

### Change Video Quality
```bash
# Higher quality (larger file)
./scripts/video-production/generate-videos.sh --resolution 3840x2160

# Lower quality (smaller file)
./scripts/video-production/generate-videos.sh --resolution 1280x720
```

### Process Multiple Scripts
```bash
# Generate videos for all markdown files
./scripts/video-production/generate-videos.sh --pattern "*.md"
```

## Output Structure

```
video-output/
├── EXECUTIVE_VIDEO_SCRIPT.mp4          # Final video
├── audio/
│   └── EXECUTIVE_VIDEO_SCRIPT-narration.mp3
├── visuals/
│   └── scene-*.png                     # 9 title cards
├── timelines/
│   └── EXECUTIVE_VIDEO_SCRIPT-timeline.json
└── render-report.json                  # Generation log
```

## Troubleshooting

### FFmpeg Not Found
```bash
sudo apt-get install ffmpeg  # Linux
brew install ffmpeg          # macOS
```

### TTS Not Working
```bash
sudo apt-get install espeak  # Linux
# macOS uses built-in 'say'
```

### Permission Denied
```bash
chmod +x scripts/video-production/generate-videos.sh
```

### Slow Generation
```bash
# Reduce resolution/FPS
./scripts/video-production/generate-videos.sh --resolution 1280x720 --fps 24
```

## Documentation

- **Complete Guide**: [VIDEO_GENERATION_GUIDE.md](VIDEO_GENERATION_GUIDE.md)
- **Summary**: [VIDEO_GENERATION_SUMMARY.md](VIDEO_GENERATION_SUMMARY.md)
- **System Docs**: [scripts/video-production/README.md](scripts/video-production/README.md)
- **Script Template**: [docs/video-portfolio/EXECUTIVE_VIDEO_SCRIPT.md](docs/video-portfolio/EXECUTIVE_VIDEO_SCRIPT.md)

## Status

✅ Video successfully generated  
✅ All tests passing  
✅ Ready to share  
✅ Documentation complete  

---

**Need Help?** See [VIDEO_GENERATION_GUIDE.md](VIDEO_GENERATION_GUIDE.md) for detailed instructions.
