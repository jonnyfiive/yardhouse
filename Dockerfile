FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY dashboard_server.py .
COPY qbo_integration.py .
COPY email_poller.py .
COPY briefing-data.json* ./
COPY production-data.json* ./

EXPOSE ${PORT:-5050}

CMD gunicorn dashboard_server:app --bind 0.0.0.0:${PORT:-5050} --workers 2 --timeout 120
