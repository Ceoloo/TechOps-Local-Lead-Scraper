# Deployment — Local Lead Scraper

## Build
```bash
docker build -t techops-lead-scraper .
```
## Run (as a worker)
Provide env from `.env` (see `.env.example`). The core library is pure-stdlib;
Airtable/source connectors require the optional deps in `requirements.txt`.

## Config
All secrets via environment. Never bake credentials into the image.
