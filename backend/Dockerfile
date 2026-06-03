FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum* ./
COPY vendor/ ./vendor/
COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -o /gitvisual-api ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Allow git to use any repo path safely
RUN git config --global --add safe.directory '*'

# Pre-trust GitHub, GitLab, Bitbucket host keys so push/pull never hangs on
# "Are you sure you want to continue connecting (yes/no)?"
RUN mkdir -p /root/.ssh && chmod 700 /root/.ssh \
 && ssh-keyscan github.com gitlab.com bitbucket.org >> /root/.ssh/known_hosts 2>/dev/null \
 && chmod 600 /root/.ssh/known_hosts

RUN mkdir -p /repos
WORKDIR /app
COPY --from=builder /gitvisual-api .

EXPOSE 8080
# Entrypoint: merge host known_hosts with our pre-trusted ones, then start
CMD ["sh", "-c", "\
  if [ -f /root/.ssh/known_hosts.host ]; then \
    cat /root/.ssh/known_hosts.host >> /root/.ssh/known_hosts 2>/dev/null || true; \
  fi && \
  ./gitvisual-api"]
