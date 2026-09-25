# A ponte precisa de um processo vivo, nao de funcao efemera.
FROM node:22-slim

WORKDIR /app

# uma dependencia do baileys (libsignal-node) vem de um pacote git; sem isso
# o npm install falha. E o lockfile aponta pra ssh://git@github.com — sem
# chave configurada no build, reescreve pra https antes de instalar.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# A sessao do WhatsApp mora aqui. MONTE UM VOLUME NESTE CAMINHO —
# sem isso, todo reinicio pede QR Code de novo.
VOLUME /app/sessao

ENV NODE_ENV=production
CMD ["node", "index.js"]
