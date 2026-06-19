# Video Generation Guide

## Overview

This repository includes an automated video production system that generates professional MP4 videos with audio narration for presenting the UCC-MCA Intelligence Platform to potential investors and employers.

## Generated Video

A professional presentation video has been successfully generated:

- **Location**: `video-output/EXECUTIVE_VIDEO_SCRIPT.mp4`
- **Duration**: 5 minutes 39 seconds (339.7 seconds)
- **Resolution**: 1920x1080 (Full HD)
- **Frame Rate**: 30 FPS
- **Video Codec**: H.264
- **Audio Codec**: AAC
- **File Size**: ~4.1 MB
- **Audio**: TTS-generated narration using espeak

## Video Content

The video covers the following sections:

1. **Executive Hook (0:00 - 0:30)** - Introduction to the business problem
2. **The Problem Landscape (0:30 - 1:15)** - Industry pain points
3. **The Insight (1:15 - 2:00)** - Strategic approach to solving the problem
4. **The Solution Architecture (2:00 - 3:00)** - Three-tier system design
5. **The Technical Sophistication (3:00 - 3:30)** - Quality and reliability
6. **The Business Impact (3:30 - 4:00)** - Measurable outcomes
7. **The Differentiators (4:00 - 4:30)** - Unique value proposition
8. **Why This Person (4:30 - 4:50)** - Personal positioning
9. **Call to Action (4:50 - 5:00)** - Next steps

## How to Generate Videos

### Prerequisites

Ensure the following are installed:
- FFmpeg 4.0+ (for video rendering)
- espeak or festival (for Linux TTS) or `say` command (for macOS)
- Node.js 18+

### Installation

On Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y ffmpeg espeak
```

On macOS:
```bash
brew install ffmpeg
# 'say' command is built-in
```

### Quick Generation

Generate the executive video:
```bash
npm run video:generate
```

Or use the shell script directly:
```bash
./scripts/video-production/generate-videos.sh
```

### Custom Configuration

Generate with custom settings:
```bash
./scripts/video-production/generate-videos.sh \
  --script-dir docs/video-portfolio \
  --pattern "*.md" \
  --output-dir /path/to/output \
  --resolution 3840x2160 \
  --fps 60
```

### Validation

Validate your setup before generating:
```bash
npm run video:validate
```

## Output Structure

After generation, the `video-output/` directory contains:

```
video-output/
├── EXECUTIVE_VIDEO_SCRIPT.mp4          # Final rendered video
├── audio/
│   └── EXECUTIVE_VIDEO_SCRIPT-narration.mp3  # Generated narration
├── visuals/
│   ├── scene-2-title.png               # Scene title cards
│   ├── scene-4-title.png
│   └── ...
├── timelines/
│   └── EXECUTIVE_VIDEO_SCRIPT-timeline.json  # Scene timing info
└── render-report.json                  # Generation report
```

## Customizing the Script

To create your own video:

1. Create a markdown file in `docs/video-portfolio/`
2. Follow the script format in `EXECUTIVE_VIDEO_SCRIPT.md`:
   - Use H2 headings (`##`) for scenes
   - Include `### Voiceover:` sections with text in `*"quotes"*`
   - Add `[PAUSE]` markers for natural breaks
   - Include `### Visual Plan:` sections for reference
3. Run the generator

## Video Properties

The generated video includes:

- **Visual Quality**: Professional 1080p resolution
- **Audio Quality**: Clear TTS narration at 22.05 kHz mono
- **Bitrate**: ~100 kbps (optimized for file size)
- **Compatibility**: H.264 codec ensures broad device compatibility
- **Accessibility**: Consider adding closed captions for wider reach

## Sharing the Video

The generated video is ready to share:

1. **Upload to video platforms**: YouTube, Vimeo, LinkedIn
2. **Embed in presentations**: Include in pitch decks
3. **Share directly**: Send the MP4 file via email or cloud storage
4. **Host on website**: Add to portfolio or project pages

**Note**: The `video-output/` directory is in `.gitignore` and will not be committed to the repository. Videos should be uploaded to external hosting platforms.

## Troubleshooting

### FFmpeg not found

Install FFmpeg:
```bash
sudo apt-get install ffmpeg  # Linux
brew install ffmpeg          # macOS
```

### TTS not working

**Linux**: Install espeak or festival:
```bash
sudo apt-get install espeak
# or
sudo apt-get install festival festvox-kallpc16k
```

**macOS**: Use built-in `say` command (pre-installed)

### Video quality issues

Adjust resolution or frame rate:
```bash
./scripts/video-production/generate-videos.sh --resolution 1280x720 --fps 24
```

### Memory issues

Generate one script at a time:
```bash
./scripts/video-production/generate-videos.sh --pattern "EXECUTIVE_VIDEO_SCRIPT.md"
```

## Additional Documentation

- **Video Production System**: [scripts/video-production/README.md](scripts/video-production/README.md)
- **Installation Guide**: [scripts/video-production/INSTALL.md](scripts/video-production/INSTALL.md)
- **Implementation Summary**: [scripts/video-production/IMPLEMENTATION_SUMMARY.md](scripts/video-production/IMPLEMENTATION_SUMMARY.md)
- **Script Template**: [docs/video-portfolio/EXECUTIVE_VIDEO_SCRIPT.md](docs/video-portfolio/EXECUTIVE_VIDEO_SCRIPT.md)
- **Production Guide**: [docs/video-portfolio/PRODUCTION_GUIDE.md](docs/video-portfolio/PRODUCTION_GUIDE.md)

## Next Steps

1. **Review the generated video**: Check `video-output/EXECUTIVE_VIDEO_SCRIPT.mp4`
2. **Customize if needed**: Edit the script and regenerate
3. **Upload to platform**: Share on YouTube, LinkedIn, or your portfolio
4. **Add captions**: Consider adding closed captions for accessibility
5. **Gather feedback**: Share with colleagues or mentors for review

## Technical Details

The video production agent uses:

- **FFmpeg**: Industry-standard video processing
- **Local TTS**: Privacy-first text-to-speech (espeak/say)
- **TypeScript**: Type-safe implementation
- **Automated Pipeline**: Full script-to-video workflow
- **Intelligent Fallbacks**: Graceful degradation when components unavailable

For questions or issues, see the main [README.md](README.md) or open an issue in the repository.
