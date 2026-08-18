FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
