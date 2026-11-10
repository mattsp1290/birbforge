ARG BIRBVERIFY_IMAGE
FROM ${BIRBVERIFY_IMAGE}
WORKDIR /opt/birbforge
COPY verification ./verification
USER 10001:10001
ENTRYPOINT ["python", "-m", "verification.kubernetes_worker"]
