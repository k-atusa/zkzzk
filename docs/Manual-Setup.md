# 💻 Manual Setup (Standalone Binary / Build from Source)

This document is a guide for users and developers who want to run ZKZZK directly on their operating system without Docker.

ZKZZK is distributed as a **single Go binary** with the frontend (HTML/JS/CSS) embedded inside—so running `./zkzzk` starts both the web dashboard and backend together with no extra web server or database server required.

---

## 1. Prerequisites

To run ZKZZK directly on your machine, install the following two tools:

1. **FFmpeg**: Essential for remuxing recorded streams into MP4.
   - Ubuntu / Debian: `sudo apt install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Windows: Download from the official FFmpeg website and add it to your `PATH` environment variable.
2. **Streamlink**: Live broadcast and VOD downloader tool.
   - Linux / Windows (Python 3 pip): `pip3 install streamlink`
   - macOS: `brew install streamlink`

*(If building from source, you also need **Go 1.26+** and **Node.js 20+**.)*

---

## 2. Option A: Run Pre-built Standalone Binary (Recommended)

1. Download the binary for your OS and architecture from **[GitHub Releases](https://github.com/k-atusa/zkzzk/releases)**:
   - Windows: `zkzzk-vX.Y.Z-windows-amd64.exe` / `zkzzk-vX.Y.Z-windows-arm64.exe`
   - Linux: `zkzzk-vX.Y.Z-linux-amd64` / `zkzzk-vX.Y.Z-linux-arm64`
   - macOS (Apple Silicon): `zkzzk-vX.Y.Z-darwin-arm64`
2. Grant execute permission and run it (Linux / macOS):
   ```bash
   chmod +x zkzzk-vX.Y.Z-linux-amd64
   ./zkzzk-vX.Y.Z-linux-amd64
   ```
   On Windows, run `zkzzk-vX.Y.Z-windows-amd64.exe` directly.

On startup, ZKZZK automatically creates `backend/database.db` (SQLite database) and `downloads/` relative to the working directory.

---

## 3. Option B: Build from Source (For Developers)

### Clone the Repository
```bash
git clone https://github.com/k-atusa/zkzzk.git
cd zkzzk
```

### Build Frontend and Copy Embedded Assets
```bash
cd frontend
npm ci
npm run build
cd ..
rm -rf backend/public
mkdir -p backend/public
cp -R frontend/dist/* backend/public/
```

### Build and Run the Go Binary
```bash
cd backend
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../zkzzk .
cd ..
./zkzzk
```

---

## 4. Optional Environment Variables & Background Execution

ZKZZK works out of the box with sensible defaults. Optional environment variables:

- `PORT`: HTTP listen port (default: `5001`)
- `DOWNLOADS_DIR`: Recording output directory (default: `./downloads`)
- `JWT_SECRET`: Secret key for signing JWT authentication cookies
- `FRONTEND_URL`: Frontend base URL for OAuth callback redirects (when behind a custom reverse proxy)

### Linux `systemd` Service Example
To keep ZKZZK running continuously in the background on Linux, create `/etc/systemd/system/zkzzk.service`:

```ini
[Unit]
Description=ZKZZK Chzzk Video Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/zkzzk
ExecStart=/opt/zkzzk/zkzzk
Restart=unless-stopped
Environment=TZ=Asia/Seoul

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now zkzzk
```

Once running, open `http://localhost:5001` in your web browser to access the dashboard!
