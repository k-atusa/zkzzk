# Use Alpine Linux as base image
FROM alpine:3.19

# Set working directory
WORKDIR /app

# Update and install basic packages
RUN apk update && \
    apk add --no-cache \
    bash \
    curl \
    ca-certificates \
    python3 \
    py3-pip \
    python3-dev \
    gcc \
    musl-dev \
    postgresql-dev \
    ffmpeg

RUN mkdir -p /app/downloads

# Set environment variables
ENV PATH="/app:${PATH}"
ENV PYTHONUNBUFFERED=1

# Create and activate virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy all application files
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install streamlink
RUN pip install --no-cache-dir streamlink

# Expose port 3000
EXPOSE 3000

# Run the application
CMD ["python3", "app.py"]
