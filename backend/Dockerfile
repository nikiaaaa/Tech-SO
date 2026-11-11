# NOT BUILT OR RUN in the authoring environment (Docker was not installed). Treat as a starting point.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini run.py ./
RUN useradd --system --uid 10001 techso && mkdir -p /srv/data && chown -R techso /srv/data
USER techso
EXPOSE 8000
# Apply migrations, then serve. Bind 0.0.0.0 only inside the container network; the web container is the public entry.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
