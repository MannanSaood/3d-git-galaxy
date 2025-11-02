# Multi-stage build for Koyeb deployment
FROM node:20-alpine AS builder

# Install build dependencies for native modules (better-sqlite3, pg)
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy source files
COPY src/ ./src/

# Note: types.ts is imported from backend/src/types.ts (see database.ts import)

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Remove build tools to reduce image size (optional, but better-sqlite3 needs runtime libs)
# RUN apk del python3 make g++

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "dist/server.js"]

