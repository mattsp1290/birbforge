ARG BIRBVERIFY_IMAGE
FROM ${BIRBVERIFY_IMAGE}
ARG BIRBVERIFY_IMAGE
ARG BIRBFORGE_REVISION
LABEL org.opencontainers.image.revision=$BIRBFORGE_REVISION \
      org.opencontainers.image.base.name=$BIRBVERIFY_IMAGE
WORKDIR /opt/birbforge
COPY verification/__init__.py verification/kubernetes*.py ./verification/
COPY packaging/kubernetes-producer.json ./packaging/kubernetes-producer.json
RUN python -c 'import os,re; from verification.kubernetes_runtime import check_producer; import json; p=json.load(open("packaging/kubernetes-producer.json")); check_producer(p["revision"]); assert re.fullmatch(r".+@sha256:[0-9a-f]{64}", os.environ["BIRBVERIFY_IMAGE"])'
USER 10001:10001
ENTRYPOINT ["python", "-m", "verification.kubernetes_worker"]
