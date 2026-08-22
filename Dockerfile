FROM harbor.sch.bme.hu/proxy-docker.io/library/nginx:1.31.4-alpine

COPY ./ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8000