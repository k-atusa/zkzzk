# 🐳 Docker Setup (가장 권장하는 방법)

초보자부터 전문가까지 가장 쉽고 안전하게 zkzzk를 설치하고 실행할 수 있는 방법입니다. Docker를 사용하면 복잡한 환경 설정(FFmpeg, Streamlink 등)을 직접 할 필요 없이 명령어 한 줄로 모든 것을 해결할 수 있습니다.

---

## 1. Docker 설치하기

먼저 컴퓨터(또는 서버)에 Docker가 설치되어 있어야 합니다.
- **Windows / Mac 사용자**: [Docker Desktop](https://www.docker.com/products/docker-desktop/)을 다운로드하여 설치해 주세요. (설치 후 프로그램이 실행 중인지 확인하세요)
- **Linux 사용자**: 터미널에 아래 명령어를 입력하여 설치할 수 있습니다.
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## 2. zkzzk 실행하기

터미널(또는 명령 프롬프트, PowerShell)을 열고 아래 명령어를 복사해서 붙여넣습니다.

### 방법 A: Docker Run 사용 (기본)

```bash
docker run -d \
  --name zkzzk-app \
  --restart unless-stopped \
  -p 5001:5001 \
  -e TZ=Asia/Seoul \
  -v $(pwd)/data:/app/backend \
  -v $(pwd)/downloads:/app/downloads \
  d3vle0/zkzzk:latest
```

### 방법 B: Docker Compose 사용 (추천)

설정 관리가 더 편한 Docker Compose를 사용하는 것을 추천합니다. `docker-compose.yml` 파일을 아래와 같이 생성합니다:

```yaml
services:
  zkzzk-app:
    image: d3vle0/zkzzk:latest
    container_name: zkzzk-app
    restart: unless-stopped
    ports:
      - "5001:5001"
    environment:
      - TZ=Asia/Seoul
    volumes:
      - ./data:/app/backend
      - ./downloads:/app/downloads
```

그 후, 파일이 있는 디렉토리에서 아래 명령어로 실행합니다:
```bash
docker compose up -d
```

> [!NOTE]
> 이전 Node.js 버전(<= v3.1.1)에서 업그레이드하는 경우, 호스트의 `./data/database.db` 파일 위치는 동일하므로 볼륨 경로만 `./data:/app/backend`로 변경하고 `DATABASE_URL` 환경변수를 제거하시면 기존 데이터가 그대로 유지됩니다.

---

## 3. 접속 및 초기 설정

명령어가 성공적으로 실행되었다면, 인터넷 브라우저(크롬, 엣지 등)를 열고 주소창에 아래 주소를 입력하세요.

👉 **http://localhost:5001**

최초 접속 시 **관리자 계정 생성** 화면이 나타납니다. 원하는 아이디와 비밀번호를 설정하시면 설치가 모두 완료됩니다! 🎉
