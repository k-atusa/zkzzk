# 🐳 Docker Setup (Highly Recommended)

This is the easiest and safest way to install and run ZKZZK for everyone, from beginners to experts. By using Docker, you don't need to manually configure environments (like FFmpeg or Streamlink). Everything can be solved with a single command line.

---

## 1. Install Docker

First, Docker must be installed on your computer (or server).
- **Windows / Mac Users**: Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/). (Make sure the program is running after installation.)
- **Linux Users**: You can install it by entering the following command in the terminal:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```

## 2. Run ZKZZK

Open your terminal (or Command Prompt, PowerShell) and copy and paste the command below.

### Option A: Using Docker Run (Default)

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

### Option B: Using Docker Compose (Recommended)

We recommend using Docker Compose for easier configuration management. Create a `docker-compose.yml` file as follows:

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

Then, run the following command in the directory where the file is located:
```bash
docker compose up -d
```

> [!NOTE]
> If you are upgrading from an earlier Node.js version(<= v3.1.1), your existing `./data/database.db` on the host stays in the exact same location—just update the volume target to `./data:/app/backend` and remove the `DATABASE_URL` environment variable to keep all your data.

---

## 3. Access and Initial Setup

If the command executed successfully, open your web browser (Chrome, Edge, etc.) and enter the address below in the address bar.

👉 **http://localhost:5001**

Upon your first visit, the **Admin Account Creation** screen will appear. Set your desired username and password, and the installation is complete! 🎉