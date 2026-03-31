FROM node:22-alpine

WORKDIR /app/server
COPY --chown=node:node server/package*.json ./
COPY --chown=node:node server/scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force

WORKDIR /app
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node data ./data
COPY --chown=node:node JSON_FORMAT_REFERENCE.md ./JSON_FORMAT_REFERENCE.md
COPY --chown=node:node server/src ./server/src

USER node

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
