FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY app/app.py ./app.py
COPY app/templates ./templates
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
    && useradd \
        --create-home \
        --uid 1000 \
        ctfuser

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "app:app","--access-logfile", "-", "--error-logfile", "-"]