ARG BIRBVERIFY_IMAGE
FROM ${BIRBVERIFY_IMAGE}
ARG BIRBVERIFY_IMAGE
ARG BIRBFORGE_REVISION
LABEL org.opencontainers.image.revision=$BIRBFORGE_REVISION \
      org.opencontainers.image.base.name=$BIRBVERIFY_IMAGE
WORKDIR /opt/birbforge
COPY verification/__init__.py verification/kubernetes*.py ./verification/
COPY packaging/kubernetes-producer.json ./packaging/kubernetes-producer.json
RUN python -m verification.kubernetes_runtime --base-image "$BIRBVERIFY_IMAGE"
USER 10001:10001
ENTRYPOINT ["python", "-m", "verification.kubernetes_worker"]
