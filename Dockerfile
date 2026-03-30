FROM node:22-slim AS build

RUN apt-get update && apt-get install -y git git-lfs && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone with LFS
ARG RAILWAY_GIT_COMMIT_SHA
RUN git lfs install && \
    git clone --depth 1 https://github.com/anima-research/wfe.git . && \
    git lfs pull

# Install deps
RUN npm install --ignore-scripts 2>/dev/null || true

FROM node:22-slim
WORKDIR /app
COPY --from=build /app .
RUN npm install --ignore-scripts 2>/dev/null || true

EXPOSE 3000
CMD ["npx", "tsx", "src/serve.ts"]
