# ROADMAP Schema Files

## ⚠️ Important Note

These local schema files are **for reference only** and are **not used by the application**.

## Actual Schema Source

Both the frontend (`js/app.js`) and backend (`api/process-pdf.js`) fetch schemas dynamically from GitHub:

- **Model Schema:** https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.model.json
- **Dataset Schema:** https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.dataset.json

This ensures that:
- ✅ Frontend and backend always use the same schema version
- ✅ Application stays in sync with official ROADMAP standard
- ✅ Schema updates are automatic (no manual syncing needed)

## Purpose of Local Files

These files serve as:
- Reference documentation for developers
- Backup in case GitHub is unavailable
- Examples for schema structure

## Updating Local Files

If you want to update these local files to match the latest GitHub versions, run:

```bash
curl https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.model.json > base-model-schema.json
curl https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.dataset.json > base-dataset-schema.json
```

However, **this is optional** since they're not used by the application.
