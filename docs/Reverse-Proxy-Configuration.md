# 🔒 Reverse Proxy Configuration (Nginx Proxy Manager / Nginx)

This is the reverse proxy configuration method used when you want to access via a domain address (e.g., `https://zkzzk.mydomain.com`) with security (HTTPS) applied, instead of typing a port number like `localhost:5001`.

---

## 🟢 Using Nginx Proxy Manager (Recommended)

Nginx Proxy Manager (NPM) is a very convenient tool that **issues free SSL certificates (HTTPS) and connects your domain with just a few clicks on a clean web UI screen**, without complex text file configurations. Highly recommended for beginners.

**1. Install Nginx Proxy Manager**
It can usually be installed easily using Docker. For detailed installation instructions, please refer to the [Official Setup Guide](https://nginxproxymanager.com/setup/).

**2. Access the Admin Web UI**
Once installation is complete, access the NPM admin page (usually `http://ServerIP:81`) and log in.

**3. Add a Proxy Host**
1. From the top menu, go to **Hosts** -> **Proxy Hosts**.
2. Click the **[Add Proxy Host]** button in the top right.
3. In the **Details Tab**, enter the following:
   - **Domain Names**: Your domain address (e.g., `zkzzk.mydomain.com`)
   - **Scheme**: `http`
   - **Forward Hostname / IP**: The internal IP address of the server where ZKZZK is installed (If you are also using Docker, enter the Docker internal network IP or host IP address).
   - **Forward Port**: `5001`
   - Turn on both the **Block Common Exploits** and **Websockets Support** options (Switch ON).

**4. Automatically Issue SSL (HTTPS) Certificate**
1. Move to the **SSL Tab** in the same window.
2. Click the dropdown for **SSL Certificate** and select `Request a new SSL Certificate`.
3. Turn on the **Force SSL** and **HTTP/2 Support** options.
4. Enter your email address and check the Let's Encrypt Terms of Service agreement (I Agree...).
5. Click the **[Save]** button, and after a moment, the certificate issuance and domain connection will be complete!

Now, if you access `https://zkzzk.mydomain.com`, you can use ZKZZK with a secure connection indicated by a padlock icon!

---

## 🔵 Manual Nginx Configuration

If you are familiar with the terminal environment and want to handle the Nginx configuration file directly, please refer to the example below.

**Nginx Configuration File (`/etc/nginx/sites-available/zkzzk`)**

```nginx
server {
    listen 80;
    server_name zkzzk.mydomain.com; # Change to your domain

    location / {
        proxy_pass http://localhost:5001; # zkzzk server port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Disable buffering so real-time SSE progress events stream immediately
        proxy_buffering off;

        # Configuration to handle uploading/downloading large video files without issues
        client_max_body_size 50000M;
    }
}
```

> [!NOTE]
> The above configuration is for HTTP only. If you want HTTPS configuration, you must issue and apply a certificate using **Certbot (Let's Encrypt)** or similar. You can easily apply SSL by entering the command `sudo certbot --nginx -d zkzzk.mydomain.com` in your terminal.
