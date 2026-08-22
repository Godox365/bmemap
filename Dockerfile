FROM harbor.sch.bme.hu/proxy-docker.io/library/nginx:1.31.4-alpine AS app

COPY ./ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# by default the app also uses './data' but an explicit statement is better
ENV BMEMAP_DATA_FOLDER /usr/share/nginx/html/data
EXPOSE 8000

# ---
FROM node:26.7.0-trixie-slim AS updater

COPY ./package.json ./package-lock.json ./update-maps.js /opt/bmemap/
WORKDIR /opt/bmemap
RUN npm install

ENV BMEMAP_DATA_FOLDER /opt/bmemap/data

CMD ["node", "update-maps.js"]