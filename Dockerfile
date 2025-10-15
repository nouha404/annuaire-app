FROM node:18-slim

# Installer Chrome et dépendances
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-driver \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier package files
COPY package*.json ./

# Installer toutes les dépendances
RUN npm ci

# Copier le projet
COPY . .

# Build Angular
RUN npm run build

# ✅ Vérifier que le build Angular a réussi
RUN ls -la dist/ && ls -la dist/annuaire-app/ || echo "❌ Angular build failed"

# Build server
RUN npm run build:server

# ✅ Vérifier que le build server a réussi
RUN ls -la dist/ && test -f dist/server.js || echo "❌ Server build failed"

# Variables d'environnement
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver
ENV NODE_ENV=production

# ✅ Railway injecte automatiquement PORT
EXPOSE 3000

# ✅ Script de démarrage avec logs
CMD ["sh", "-c", "echo '🚀 Starting server...' && ls -la dist/ && node dist/server.js"]