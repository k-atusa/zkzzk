# 💻 Manual Setup (단일 바이너리 / 소스 빌드)

이 문서는 Docker를 사용하지 않고 운영체제에 직접 zkzzk를 실행하거나 소스에서 빌드하고 싶은 분들을 위한 가이드입니다.

zkzzk는 프론트엔드(HTML/JS/CSS)가 내장된 **Go 단일 실행 바이너리**로 배포되므로, 별도의 웹 서버나 데이터베이스 서버를 구성하지 않아도 `./zkzzk` 하나만으로 바로 실행할 수 있습니다.

---

## 1. 필수 사전 준비 (Prerequisites)

직접 실행하기 위해서는 아래 두 가지 도구가 시스템에 설치되어 있어야 합니다.

1. **FFmpeg**: 녹화 영상 MP4 변환(remux)을 위해 필수입니다.
   - Ubuntu / Debian: `sudo apt install ffmpeg`
   - macOS: `brew install ffmpeg`
   - Windows: FFmpeg 공식 홈페이지에서 다운로드 후 환경변수 `PATH` 추가
2. **Streamlink**: 치지직 라이브 방송 및 VOD 다운로더 도구입니다.
   - Linux / Windows (Python 3 pip): `pip3 install streamlink`
   - macOS: `brew install streamlink`

*(소스 코드에서 직접 빌드하는 경우 추가로 **Go 1.26 이상** 및 **Node.js 20 이상**이 필요합니다.)*

---

## 2. 방법 A: 릴리즈 단일 바이너리 바로 실행 (간편)

1. **[GitHub Releases](https://github.com/k-atusa/zkzzk/releases)** 페이지에서 본인 운영체제와 아키텍처에 맞는 바이너리를 다운로드합니다.
   - Windows: `zkzzk-vX.Y.Z-windows-amd64.exe` / `zkzzk-vX.Y.Z-windows-arm64.exe`
   - Linux: `zkzzk-vX.Y.Z-linux-amd64` / `zkzzk-vX.Y.Z-linux-arm64`
   - macOS (Apple Silicon): `zkzzk-vX.Y.Z-darwin-arm64`
2. 다운로드한 파일에 실행 권한을 부여하고 실행합니다 (Linux / macOS 기준):
   ```bash
   chmod +x zkzzk-vX.Y.Z-linux-amd64
   ./zkzzk-vX.Y.Z-linux-amd64
   ```
   Windows에서는 `zkzzk-vX.Y.Z-windows-amd64.exe`를 직접 실행합니다.

실행 시 현재 경로 기준으로 `backend/database.db`(SQLite 데이터베이스)와 `downloads/`(녹화본 저장 폴더)가 자동으로 생성됩니다.

---

## 3. 방법 B: 소스 코드에서 직접 빌드 (개발자용)

### 프로젝트 클론
```bash
git clone https://github.com/k-atusa/zkzzk.git
cd zkzzk
```

### 프론트엔드 빌드 및 임베드 준비
```bash
cd frontend
npm ci
npm run build
cd ..
rm -rf backend/public
mkdir -p backend/public
cp -R frontend/dist/* backend/public/
```

### Go 단일 바이너리 빌드 및 실행
```bash
cd backend
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../zkzzk .
cd ..
./zkzzk
```

---

## 4. 선택 환경변수 및 백그라운드 실행

기본 설정 그대로 바로 사용할 수 있으며, 필요에 따라 아래 환경변수를 지정할 수 있습니다.

- `PORT`: 서버 포트 번호 (기본값: `5001`)
- `DOWNLOADS_DIR`: 녹화 파일 저장 경로 (기본값: `./downloads`)
- `JWT_SECRET`: JWT 서명용 비밀키
- `FRONTEND_URL`: OAuth 콜백 리디렉션 대상 프론트엔드 주소 (리버스 프록시 환경에서 필요 시 설정)

### Linux `systemd` 백그라운드 서비스 예시
서버를 무중단으로 계속 켜두고 싶다면 `systemd` 서비스로 등록하는 것을 권장합니다 (`/etc/systemd/system/zkzzk.service`).

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

성공적으로 실행되었다면 웹 브라우저에서 `http://localhost:5001` 로 접속하여 대시보드를 사용할 수 있습니다!
