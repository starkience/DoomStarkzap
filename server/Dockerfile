FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc
CMD ["node", "dist/index.js"]
