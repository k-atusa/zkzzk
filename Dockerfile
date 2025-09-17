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
    wget \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/downloads

# Set environment variables
ENV PATH="/app:${PATH}"
ENV PYTHONUNBUFFERED=1
ENV TZ=Asia/Seoul

# Copy all application files
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Expose port 3000
EXPOSE 3000

# Run the application with timezone setup from TZ env
CMD ["/bin/sh", "-c", "ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && exec python app.py"]
