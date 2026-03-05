

## Update GOOGLE_VISION_SA_KEY Secret Value

### Problem
The `GOOGLE_VISION_SA_KEY` secret currently contains a 40-character hex string (likely a key fingerprint or hash). The code expects the **full JSON content** of a Google Cloud service account key file.

### What You Need To Do

1. Go to **Google Cloud Console** → IAM & Admin → Service Accounts
2. Select (or create) a service account with **Cloud Vision API** enabled
3. Create a new JSON key → download the `.json` file
4. The file content looks like:
```json
{
  "type": "service_account",
  "project_id": "your-project",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "vision@your-project.iam.gserviceaccount.com",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```
5. **Recommended**: Base64-encode the entire JSON file to avoid escaping issues:
   ```bash
   base64 -w 0 your-sa-key.json
   ```
6. Store that base64 string (or the raw JSON) as the new value for `GOOGLE_VISION_SA_KEY`

### What I Will Do
Use the secrets tool to prompt you to update the `GOOGLE_VISION_SA_KEY` value with the correct service account JSON (or its base64-encoded version). The code already supports both formats.

No code changes needed — the parsing logic (direct JSON + base64 decode) is already in place.

