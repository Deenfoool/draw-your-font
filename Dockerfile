FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build:runtime

FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN rm -rf node_modules tests source-parts .git .github \
  && mkdir -p /data/public-fonts \
  && chown -R node:node /data
ENV HOST=0.0.0.0
ENV PORT=8000
ENV DYFR_DATA_DIR=/data/public-fonts
VOLUME ["/data"]
EXPOSE 8000
USER node
CMD ["node", "server.mjs"]
