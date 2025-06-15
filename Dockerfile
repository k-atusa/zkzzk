# Use Python 3.13.3 as base image
FROM python:3.13.3-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/downloads

# Set environment variables
ENV PATH="/app:${PATH}"
ENV PYTHONUNBUFFERED=1

# Copy all application files
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install streamlink
RUN pip install --no-cache-dir streamlink

# Expose port 3000
EXPOSE 3000

# Run the application
CMD ["python", "app.py"]
