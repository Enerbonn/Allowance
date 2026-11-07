FROM node:24.22.1-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY src/package.json ./src/package.json
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY docker-start.sh ./docker-start.sh
RUN sed -i 's/\r$//' docker-start.sh
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production ALLOWANCE_DATA_DIR=/data PORT=4310
EXPOSE 4310
CMD ["sh", "docker-start.sh"]
