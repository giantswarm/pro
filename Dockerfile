# Build stage
FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

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
