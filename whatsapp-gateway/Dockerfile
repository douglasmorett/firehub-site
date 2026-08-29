FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
# O `sed` tira CRLF antes do chmod. O .gitattributes da raiz ja normaliza para
# LF no repositorio, mas um `docker build` a partir de uma copia de trabalho no
# Windows ainda traria CRLF — e com CRLF o sh do Alpine morre em
# "unset: NODE_OPTIONS: bad variable name" e o container entra em crash-loop.
# Duas travas para o mesmo buraco, porque ele ja derrubou o gateway uma vez.
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh
EXPOSE 8080
ENTRYPOINT ["sh", "./start.sh"]
