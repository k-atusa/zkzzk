<h1 align=center>zkzzk</h1>

<p align=center>🎬 Chzzk Video Manager</p>

<p align="center">
  <a href="https://github.com/k-atusa/zkzzk/releases"><img src="https://img.shields.io/github/v/release/k-atusa/zkzzk?style=flat-square" alt="Release"></a> <a href="https://github.com/k-atusa/zkzzk/blob/main/LICENSE"><img src="https://img.shields.io/github/license/k-atusa/zkzzk?style=flat-square" alt="License"></a> <a href="https://hub.docker.com/r/d3vle0/zkzzk"><img src="https://img.shields.io/docker/pulls/d3vle0/zkzzk?style=flat-square" alt="Docker Pulls"></a> <a href="https://github.com/k-atusa/zkzzk/stargazers"><img src="https://img.shields.io/github/stars/k-atusa/zkzzk?style=flat-square" alt="Stars"></a> <a href="https://img.shields.io/github/languages/code-size/k-atusa/zkzzk?style=flat-square"><img src="https://img.shields.io/github/languages/code-size/k-atusa/zkzzk?style=flat-square" alt="Code Size"></a>
</p>
<p align="right">
  <a href="README.md">🇺🇸 English</a> | <a href="README-ko.md">🇰🇷 한국어</a>
</p>


## 🤔 What is this project?

zkzzk is an open-source web application that automatically records [Naver Chzzk](https://chzzk.naver.com) broadcasts and manages recorded videos. It is for those who want to automatically backup Chzzk broadcasts or easily save VODs.

- When you add a desired streamer in the list, recording automatically starts when the broadcast begins.
- Recorded videos can be easily viewed and downloaded through the web.
- Enter a Chzzk replay (VOD) video URL to download in your desired resolution.

## ⚙️ Installation

### 1. Direct deployment

```sh
git clone https://github.com/k-atusa/zkzzk
cd zkzzk
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 app.py
```

### 2. Docker container (Recommended)

Create a `docker-compose.yml` file as follows.

```yml
version: "3.9"

services:
  zkzzk:
    image: d3vle0/zkzzk:latest
    container_name: zkzzk
    ports:
      - "<external port>:3000"
    volumes:
      - ./downloads:/app/downloads
    restart: unless-stopped
```

```sh
docker compose up -d
```
