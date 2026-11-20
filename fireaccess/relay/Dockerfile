FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ver.html ./
ENV PORT=8790 FIREACCESS_REGISTROS=/dados/registros
VOLUME /dados
EXPOSE 8790
CMD ["node", "server.mjs"]
