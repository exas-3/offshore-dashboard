# syntax = docker/dockerfile:1

FROM node:22-slim

WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

# Install all dependencies (including dev — needed for vite build)
COPY package-lock.json package.json ./
RUN npm ci

# Copy source and build the React frontend
COPY . .
RUN npm run build

# Drop dev dependencies from the final image
RUN npm prune --omit=dev

EXPOSE 3001
CMD ["node", "server/index.js"]
