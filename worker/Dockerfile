# Blue Belt Media — Tournament Watcher render worker
# Base image ships Chromium + all OS deps + Xvfb, matched to the Playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.56.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PROFILE_DIR=/data/profile \
    CHROMIUM_NO_SANDBOX=1

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
RUN mkdir -p /data/profile

EXPOSE 8080

# HEADLESS=headed needs a display; xvfb-run provides one. For "new"/"shell" plain `node` is enough,
# but running under xvfb is harmless, so one command covers every mode.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x800x24", "node", "src/server.mjs"]
