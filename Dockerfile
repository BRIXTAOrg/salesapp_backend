# --------------------------------------------------------------------------
# Stage 1: Builder (Builds source code and development dependencies)
# --------------------------------------------------------------------------
FROM node:25-alpine AS builder

WORKDIR /app

# 1. Install all dependencies for build
COPY package.json package-lock.json ./
RUN npm install --production=false

# 2. Build the application 
COPY . .
RUN npm run build

# --------------------------------------------------------------------------
# Stage 2: Dependencies (Installs production dependencies only)
# --------------------------------------------------------------------------
FROM node:25-alpine AS dependencies

WORKDIR /app

# 1. Copy package files
COPY package.json package-lock.json ./

# 2. Install ONLY production dependencies
# This uses the larger 'alpine' image to correctly handle any native bindings,
# but we will only copy the resulting node_modules folder.
RUN npm install --production=true

# --------------------------------------------------------------------------
# Stage 3: Runner (The smallest final runtime image)
# --------------------------------------------------------------------------
# Use a much smaller, dedicated runtime image
FROM node:25-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# 1. Copy production node_modules from the 'dependencies' stage
COPY --from=dependencies /app/node_modules ./node_modules

# 2. Copy the built source code from the 'builder' stage
COPY --from=builder /app/dist ./dist

# 3. Copy package.json for the 'start' script to work
COPY package.json ./

# Expose the default port
EXPOSE 8000

# Use the 'start' script from package.json to run the app
CMD [ "npm", "run", "start" ]