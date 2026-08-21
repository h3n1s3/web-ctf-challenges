FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /bot

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package*.json ./

RUN npm install --omit=dev

COPY bot.js ./

CMD ["npm", "start"]