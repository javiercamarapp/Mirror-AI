FROM node:20-slim

WORKDIR /app

# Install dependencies for sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --production

COPY src ./src
COPY tsconfig.json ./

RUN npx tsc

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
