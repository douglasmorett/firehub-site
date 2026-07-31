FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN chmod +x start.sh
EXPOSE 8080
ENTRYPOINT ["sh", "./start.sh"]
