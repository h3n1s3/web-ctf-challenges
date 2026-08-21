FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY src/ /app/

RUN useradd --create-home --uid 1000 ctfuser

RUN touch /flag.txt \
    && chown ctfuser:ctfuser /flag.txt \
    && chmod 600 /flag.txt

USER ctfuser

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "app:app"]