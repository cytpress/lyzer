FROM alpine:3.22

RUN apk add --no-cache bash curl tzdata util-linux

WORKDIR /app

COPY scripts/lyzer-*.sh /app/scripts/
COPY ops/scheduler/crontab /etc/crontabs/root

RUN chmod 0755 /app/scripts/lyzer-*.sh

CMD ["crond", "-f", "-l", "2"]
