FROM node:22-bookworm-slim AS node

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=node /usr/local/ /usr/local/

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git openssh-client \
    && npm install --global @openai/codex @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app

COPY pyproject.toml ./
COPY backend ./backend
RUN pip install --no-cache-dir .

EXPOSE 8000

CMD ["uvicorn", "orchestrator.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
