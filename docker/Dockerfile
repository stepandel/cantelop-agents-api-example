FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global opencode-ai@1.18.30
# Cantelop supplies the runtime user, startup command and durable /workspace.
