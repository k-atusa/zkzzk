# Stage 1: Base image
FROM node:24-alpine AS base
RUN apk add --no-cache python3 py3-pip ffmpeg tzdata

# Stage 2: Build Frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 3: Build Backend
FROM base AS backend-builder
WORKDIR /app/backend
ENV DATABASE_URL="file:/app/backend/data/database.db"
ENV NODE_OPTIONS="--max-old-space-size=4096"
COPY backend/package*.json ./
# Install build tools for better-sqlite3
RUN apk add --no-cache make g++ python3
RUN npm ci
COPY backend/ .
# Generate Prisma client
RUN npm run prisma:generate
RUN npm run build

# Stage 4: Production Runtime
FROM base
WORKDIR /app/backend

# Install streamlink
RUN pip install --no-cache-dir streamlink --break-system-packages

# Set default environment variables
ENV TZ=Asia/Seoul
ENV DATABASE_URL="file:/app/backend/data/database.db"

# Copy node_modules and built code from backend builder
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/src/generated ./src/generated
COPY --from=backend-builder /app/backend/package*.json ./
COPY --from=backend-builder /app/backend/prisma ./prisma
COPY --from=backend-builder /app/backend/prisma.config.ts ./
# Copy built frontend to the expected path by backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 5001

# Add startup script to run prisma migrations before starting the app
CMD ["sh", "-c", "npx prisma db push && npm run start:prod"]