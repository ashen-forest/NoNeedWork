FROM node:24.9.0-bookworm-slim

RUN groupadd --gid 10001 noneedwork \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin noneedwork \
    && mkdir -p /workspace /seed \
    && chown 10001:10001 /workspace /seed

COPY --chown=10001:10001 entrypoint.sh /usr/local/bin/noneedwork-entrypoint
RUN chmod 0555 /usr/local/bin/noneedwork-entrypoint

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/noneedwork-entrypoint"]
CMD ["sleep", "infinity"]
