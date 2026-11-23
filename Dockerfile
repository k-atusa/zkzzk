# Stage 1: Build Frontend
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Build Go Backend with Embedded Frontend
FROM golang:1.26-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./public
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /app/zkzzk .

# Stage 3: Production Runtime
FROM alpine:3.24
WORKDIR /app

RUN apk add --no-cache python3 py3-pip ffmpeg tzdata \
  && pip install --no-cache-dir streamlink --break-system-packages

ENV TZ=Asia/Seoul
ENV DOWNLOADS_DIR="/app/downloads"

COPY --from=backend-builder /app/zkzzk /app/zkzzk

EXPOSE 5001

CMD ["/app/zkzzk"]
