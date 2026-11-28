# Build stage
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application from builder stage
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/src ./src

# Create a non-root user
RUN addgroup -S pro && adduser -S pro-user -G pro
USER pro-user

# Set environment variables
ENV NODE_ENV=production

# Expose HTTP transport port
EXPOSE 8080

ENTRYPOINT ["node", "bin/index.js"]

# Default to streamable-http in container deployments
CMD ["--transport=streamable-http"]
