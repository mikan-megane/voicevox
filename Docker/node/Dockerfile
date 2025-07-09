FROM node:20-slim
RUN apt update \
    && apt install -y lame curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*