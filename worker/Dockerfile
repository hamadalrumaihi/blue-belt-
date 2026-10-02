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
# Patchright (ENGINE=patchright) needs its own Chromium build; Playwright's is already in the base image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx patchright install chromium

COPY src ./src
COPY start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /data/profile

EXPOSE 8080

# start.sh runs node directly for headless modes and only wraps in Xvfb for HEADLESS=headed.
CMD ["./start.sh"]
