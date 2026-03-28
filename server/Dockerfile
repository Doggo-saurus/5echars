FROM node:22-alpine

WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

WORKDIR /app
COPY public ./public
COPY src ./src
COPY data ./data
COPY JSON_FORMAT_REFERENCE.md ./JSON_FORMAT_REFERENCE.md
COPY server ./server

RUN chown -R node:node /app
USER node

WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
