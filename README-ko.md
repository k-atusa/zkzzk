<h1 align=center>zkzzk - 직지직</h1>

<p align=center>🎬 <strong>직</strong>접 녹화하는 치<strong>지직</strong></p>

<p align="center">
  <a href="https://github.com/k-atusa/zkzzk/releases"><img src="https://img.shields.io/github/v/release/k-atusa/zkzzk?style=flat-square" alt="Release"></a> <a href="https://github.com/k-atusa/zkzzk/blob/main/LICENSE"><img src="https://img.shields.io/github/license/k-atusa/zkzzk?style=flat-square" alt="License"></a> <a href="https://hub.docker.com/r/d3vle0/zkzzk"><img src="https://img.shields.io/docker/pulls/d3vle0/zkzzk?style=flat-square" alt="Docker Pulls"></a> <a href="https://github.com/k-atusa/zkzzk/stargazers"><img src="https://img.shields.io/github/stars/k-atusa/zkzzk?style=flat-square" alt="Stars"></a> <a href="https://img.shields.io/github/languages/code-size/k-atusa/zkzzk?style=flat-square"><img src="https://img.shields.io/github/languages/code-size/k-atusa/zkzzk?style=flat-square" alt="Code Size"></a>
</p>

<p align="right">
  <a href="README-ko.md">🇰🇷 한국어</a> | <a href="README.md">🇺🇸 English</a>
</p>

## 🤔 어떤 프로젝트인가요?

zkzzk는 치지직(Chzzk) 방송을 자동으로 녹화하고, 녹화된 영상을 관리할 수 있는 오픈소스 웹 애플리케이션입니다. 치지직 방송을 자동으로 백업하거나, 다시보기를 손쉽게 저장하고 싶은 분들을 위해 만들어졌습니다.

- 원하는 스트리머를 등록하면, 방송이 시작될 때 자동으로 녹화가 시작됩니다.
- 녹화된 영상은 웹에서 쉽게 확인하고 다운로드할 수 있습니다.
- 치지직 다시보기(VOD) 영상 URL을 입력하면 원하는 화질로 다운로드할 수 있습니다.

## ⚙️ 설치 방법

### 1. 직접 실행

```sh
git clone https://github.com/k-atusa/zkzzk
cd zkzzk
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 app.py
```

### 2. Docker 컨테이너 실행 (권장)

본 레포지토리에 있는 `docker-compose.yml` 파일을 다운로드 합니다.

```sh
curl -O https://raw.githubusercontent.com/k-atusa/zkzzk/refs/heads/main/docker-compose.yml
```

`docker-compose.yml` 을 열고 `TZ` 환경변수 값을 원하는 시간대로 바꿉니다. (기본값: `Asia/Seoul`)

```yaml
services:
  zkzzk:
    image: d3vle0/zkzzk:latest
    container_name: zkzzk
    environment:
      - TZ=Asia/Seoul  # Change this to your timezone (e.g., Europe/London, America/New_York)
    ports:
      - "10000:3000"
    volumes:
      - ./downloads:/app/downloads
    restart: unless-stopped
```

컨테이너를 실행합니다.

```sh
docker compose up -d
```
