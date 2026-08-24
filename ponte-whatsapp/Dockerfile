# A ponte precisa de um processo vivo, nao de funcao efemera.
FROM node:22-slim

WORKDIR /app

# baileys usa criptografia nativa; nada de compilar aqui
COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# A sessao do WhatsApp mora aqui. MONTE UM VOLUME NESTE CAMINHO —
# sem isso, todo reinicio pede QR Code de novo.
VOLUME /app/sessao

ENV NODE_ENV=production
CMD ["node", "index.js"]
