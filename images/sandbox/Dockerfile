FROM node:24.9.0-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 noneedwork \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin noneedwork \
    && mkdir -p /workspace \
    && chown 10001:10001 /workspace

COPY --chown=10001:10001 entrypoint.sh /usr/local/bin/noneedwork-entrypoint
RUN chmod 0555 /usr/local/bin/noneedwork-entrypoint

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/noneedwork-entrypoint"]
CMD ["sleep", "infinity"]
