FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
ENV PYTHONPATH=/app/src
CMD ["python", "-c", "import lead_scraper; print('lead_scraper', lead_scraper.__version__)"]
