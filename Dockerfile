FROM node:24-alpine

WORKDIR /srv/app/app
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY app/server.js ./
COPY app/lib ./lib
COPY app/public ./public

# Agent prompts and the fictional demo data (textbook, item base, prerecorded agent answers)
COPY instrukcii /srv/app/instrukcii
COPY demo /srv/app/demo

RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "server.js"]
