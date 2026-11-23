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

### 💡 명령어 상세 설명 (초보자용 가이드)
명령어가 길어 보이지만, 각각의 줄은 아주 단순한 의미를 가지고 있습니다.

- `docker run -d`: 도커 컨테이너를 백그라운드(보이지 않는 곳)에서 실행하라는 뜻입니다. 터미널을 꺼도 프로그램이 계속 돌아갑니다.
- `--name zkzzk-app`: 실행되는 도커 프로그램의 이름을 `zkzzk-app`으로 지정합니다.
- `--restart unless-stopped`: 컴퓨터(서버)가 재부팅되거나 도커가 다시 시작될 때 자동으로 앱을 실행하도록 설정합니다.
- `-p 5001:5001`: 접속할 포트 번호입니다. 인터넷 브라우저에서 `http://localhost:5001` 로 접속할 수 있게 해줍니다.
- `-e TZ=Asia/Seoul`: 시스템의 시간을 한국 시간(KST)으로 맞춥니다.
- `-v ...`: **볼륨 마운트(Volume Mount)** 설정입니다. 컨테이너가 꺼지거나 삭제되더라도 **녹화된 영상과 데이터베이스(설정 정보)가 지워지지 않고 여러분의 컴퓨터에 안전하게 저장**되도록 연결해 주는 아주 중요한 명령어입니다.
  - `./data:/app/backend`: 계정 정보 및 설정 데이터베이스(`database.db`) 파일이 저장되는 폴더 (`DATABASE_URL`을 별도로 지정할 필요 없이 자동으로 `/app/backend/database.db`를 사용합니다.)
  - `./downloads:/app/downloads`: 라이브 방송 녹화본 및 VOD 영상이 저장되는 폴더
- `d3vle0/zkzzk:latest`: 도커 허브에서 zkzzk의 최신 버전을 가져와서 실행합니다.

> [!NOTE]
> 이전 Node.js 버전(`-v ./data:/app/backend/data`)에서 업그레이드하는 경우, 호스트의 `./data/database.db` 파일 위치는 동일하므로 볼륨 경로만 `./data:/app/backend`로 변경하고 `DATABASE_URL` 환경변수를 제거하시면 기존 데이터가 그대로 유지됩니다.

---

## 3. 접속 및 초기 설정

명령어가 성공적으로 실행되었다면, 인터넷 브라우저(크롬, 엣지 등)를 열고 주소창에 아래 주소를 입력하세요.

👉 **http://localhost:5001**

최초 접속 시 **관리자 계정 생성** 화면이 나타납니다. 원하는 아이디와 비밀번호를 설정하시면 설치가 모두 완료됩니다! 🎉

### 도커 컨테이너 중지 및 시작
만약 잠시 끄고 싶거나 다시 켜고 싶다면 아래 명령어를 사용하세요.
- **중지**: `docker stop zkzzk-app`
- **시작**: `docker start zkzzk-app`
- **삭제**: `docker rm -f zkzzk-app` (삭제해도 데이터는 아까 연결해둔 폴더에 남아있으니 안심하세요!)
