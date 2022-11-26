FROM node:18-alpine

WORKDIR /opt/app

RUN set -x && \
    apk --no-cache add \
    git \
    python3 \
    make \
    g++

COPY package*.json .
RUN npm install

COPY ./scripts ./scripts
COPY ./database.sqlite3 ./database.sqlite3

COPY ./src ./src

EXPOSE 3001
CMD [ "npm", "run", "seed" ]
