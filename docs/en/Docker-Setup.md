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

### 💡 Detailed Command Explanation (For Beginners)
The command might look long, but each line has a very simple meaning.

- `docker run -d`: Runs the Docker container in the background. The program continues to run even if you close the terminal.
- `--name zkzzk-app`: Sets the name of the running Docker container to `zkzzk-app`.
- `--restart unless-stopped`: Configures the app to automatically start when the computer (server) reboots or Docker restarts.
- `-p 5001:5001`: The port number to connect to. This allows you to access `http://localhost:5001` in your web browser.
- `-e TZ=Asia/Seoul`: Sets the system time to Korean Standard Time (KST). Change this if you are in a different timezone.
- `-v ...`: This is the **Volume Mount** setting. This connects folders so that **your recorded videos and database (settings information) are not deleted and are safely saved on your computer** even if the container is stopped or removed.
  - `./data:/app/backend`: The directory where the SQLite database file (`database.db`) containing account info and settings is stored (ZKZZK automatically uses `/app/backend/database.db` without needing `DATABASE_URL`).
  - `./downloads:/app/downloads`: The folder where recorded live broadcasts and downloaded VODs are saved.
- `d3vle0/zkzzk:latest`: Fetches the latest version of ZKZZK from Docker Hub and runs it.

> [!NOTE]
> If you are upgrading from an earlier Node.js version (`-v ./data:/app/backend/data`), your existing `./data/database.db` on the host stays in the exact same location—just update the volume target to `./data:/app/backend` and remove the `DATABASE_URL` environment variable to keep all your data.

---

## 3. Access and Initial Setup

If the command executed successfully, open your web browser (Chrome, Edge, etc.) and enter the address below in the address bar.

👉 **http://localhost:5001**

Upon your first visit, the **Admin Account Creation** screen will appear. Set your desired username and password, and the installation is complete! 🎉

### Stopping and Starting the Docker Container
If you want to temporarily turn it off or turn it back on, use the commands below.
- **Stop**: `docker stop zkzzk-app`
- **Start**: `docker start zkzzk-app`
- **Delete**: `docker rm -f zkzzk-app` (Don't worry, your data will remain in the folders you connected earlier even if you delete it!)
