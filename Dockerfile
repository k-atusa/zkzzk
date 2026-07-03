# Stage 1: Base image with Python3 (used by both backend builder and runtime)
FROM node:26-bookworm-slim AS base
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*

# Stage 2: Build Frontend
FROM node:26-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 3: Build Backend
FROM base AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci
COPY backend/ .
# Generate Prisma client
RUN npx prisma generate
RUN npm run build

# Stage 4: Production Runtime
FROM base
WORKDIR /app/backend

# Install timezone data, ffmpeg, pip, and streamlink (python3 is already in base)
RUN apt-get update && apt-get install -y \
    tzdata \
    ffmpeg \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install streamlink --break-system-packages

# Set default environment variables
ENV TZ=Asia/Seoul
ENV DATABASE_URL="file:/app/backend/data/database.db"
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Copy node_modules and built code from backend builder
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/package*.json ./
COPY --from=backend-builder /app/backend/prisma ./prisma
COPY --from=backend-builder /app/backend/prisma.config.ts ./
# Copy built frontend to backend's public directory
COPY --from=frontend-builder /app/frontend/dist ./public

EXPOSE 5001

# Add startup script to run prisma migrations before starting the app
CMD ["sh", "-c", "npx prisma db push && npm run start:prod"]
