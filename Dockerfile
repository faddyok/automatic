FROM mcr.microsoft.com/playwright:v1.62.0-noble

USER root

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    xvfb fluxbox x11vnc novnc websockify nginx openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN chmod +x /app/start.sh

ENV NODE_ENV=production
ENV DISPLAY=:99

CMD ["/app/start.sh"]
