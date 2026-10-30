FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# LiteParse relies on LibreOffice to convert Office documents.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start", "--", "--host", "0.0.0.0", "--port", "3000"]
