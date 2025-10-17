# Deployment Guide - ROADMAP Model Card Editor
## 100% Static Site Deployment

**Version:** 2.0.0 (Simplified, No Backend)

---

## Quick Start - Local Testing

### Method 1: Direct File Open (Simplest)
```bash
# Just open index.html in your browser
open index.html  # macOS
start index.html  # Windows
xdg-open index.html  # Linux
```

### Method 2: Local HTTP Server (Recommended for testing)
```bash
# Using Python (built-in)
python -m http.server 8080

# Using Node.js http-server
npx http-server . -p 8080 -c-1

# Using PHP (if installed)
php -S localhost:8080

# Then visit: http://localhost:8080
```

---

## Production Deployment Options

### 🌟 Option 1: GitHub Pages (Recommended - Free & Easy)

**Setup Time:** 2 minutes

**Steps:**
```bash
# 1. Create gh-pages branch
git checkout -b gh-pages

# 2. Commit your changes
git add .
git commit -m "Deploy to GitHub Pages"

# 3. Push to GitHub
git push origin gh-pages

# 4. Enable GitHub Pages in repo settings:
#    Settings → Pages → Source: gh-pages branch
```

**Your site will be live at:**
```
https://yourusername.github.io/roadmap-json/
```

**Auto-Deploy:**
Every push to `gh-pages` branch automatically updates your site!

---

### Option 2: Netlify (Drag & Drop Deployment)

**Setup Time:** 1 minute

**Steps:**
1. Visit https://app.netlify.com/drop
2. Drag your entire project folder onto the page
3. Done! You'll get a URL like: `https://random-name.netlify.app`

**Optional - Connect Git for Auto-Deploy:**
1. Visit https://app.netlify.com
2. Click "New site from Git"
3. Connect your GitHub repository
4. Build settings:
   - Build command: (leave empty)
   - Publish directory: `/`
5. Deploy!

**Features:**
- ✅ Free tier (100GB bandwidth/month)
- ✅ Custom domain support
- ✅ HTTPS automatically
- ✅ Auto-deploy on git push

---

### Option 3: Cloudflare Pages

**Setup Time:** 3 minutes

**Steps:**
1. Visit https://pages.cloudflare.com
2. Sign in with GitHub
3. Select your repository
4. Configure:
   - Build command: (leave empty)
   - Build output directory: `/`
5. Click "Save and Deploy"

**Features:**
- ✅ Free unlimited requests
- ✅ Global CDN (fastest)
- ✅ HTTPS automatically
- ✅ Custom domain support

---

### Option 4: Vercel (If you still want to use it)

**Note:** No longer required, but if you prefer:

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

**Benefits of switching away from Vercel:**
- ❌ Vercel was only needed for serverless functions (now gone)
- ✅ GitHub Pages/Netlify/Cloudflare are simpler for static sites
- ✅ No build process needed

---

### Option 5: AWS S3 + CloudFront

**Setup Time:** 10-15 minutes (more complex)

**Steps:**
1. Create S3 bucket with public read access
2. Upload all files to bucket
3. Enable static website hosting
4. (Optional) Configure CloudFront CDN
5. (Optional) Add custom domain via Route 53

**Cost:** ~$0.50-2/month (depending on traffic)

---

### Option 6: Any Web Server

**Just upload these files:**
```
your-server/
├── index.html
├── css/
├── js/
└── examples/
```

**Works on:**
- Shared hosting (cPanel, Plesk, etc.)
- Apache web server
- Nginx
- Any file server

**Configuration:** None needed! Just serve the files.

---

## Custom Domain Setup

### For GitHub Pages:
```bash
# 1. Create CNAME file in root
echo "yourdomain.com" > CNAME

# 2. Add DNS records at your domain provider:
# A Record:    @ → 185.199.108.153
# A Record:    @ → 185.199.109.153
# A Record:    @ → 185.199.110.153
# A Record:    @ → 185.199.111.153
# CNAME Record: www → yourusername.github.io
```

### For Netlify/Cloudflare:
Follow their GUI - they provide automatic DNS configuration!

---

## Environment Configuration

### No Environment Variables Needed! 🎉

The old backend required:
- ❌ `GEMINI_API_KEY` (secret)
- ❌ `GOOGLE_CLOUD_KEY` (secret)
- ❌ `DOCUMENT_AI_PROCESSOR_ID` (secret)

The new static site requires:
- ✅ Nothing! Users provide their own API keys

---

## Monitoring & Analytics (Optional)

### Add Google Analytics:
```html
<!-- In index.html, before </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

### Add Plausible Analytics (Privacy-friendly):
```html
<script defer data-domain="yourdomain.com" src="https://plausible.io/js/script.js"></script>
```

---

## Testing Your Deployment

### Checklist:
- [ ] Page loads without errors
- [ ] API key input appears at top
- [ ] Can save/clear API key
- [ ] PDF upload works after entering key
- [ ] All external libraries load (PDF.js, Bootstrap, etc.)
- [ ] GitHub schemas load correctly (check browser console)
- [ ] JSON download works
- [ ] No 404 errors in browser console

### Test URLs:
```
https://yourdomain.com/                   # Home page
https://yourdomain.com/js/app.js          # JavaScript files
https://yourdomain.com/css/style.css      # CSS files
```

---

## Troubleshooting

### Issue: "Failed to load PDF.js worker"
**Solution:** Check CDN URLs in index.html are correct:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
```

### Issue: "isApiKeyConfigured is not defined"
**Solution:** Check script loading order in index.html:
```html
<script src="js/pdf-extractor.js"></script>
<script src="js/gemini-client.js"></script>
<script src="js/app.js"></script>
```

### Issue: CORS errors loading schemas
**Solution:** Ensure your deployment serves files with correct MIME types. Most static hosts do this automatically.

### Issue: API key not persisting
**Solution:** Check browser localStorage is enabled. Some privacy modes block localStorage.

---

## Performance Optimization (Optional)

### Enable Gzip Compression:
Most hosts enable this automatically. For GitHub Pages, it's automatic.

### Use CDN for Assets:
Already done! All external libraries load from CDN:
- ✅ PDF.js → cdnjs.cloudflare.com
- ✅ Bootstrap → cdn.jsdelivr.net
- ✅ jQuery → code.jquery.com
- ✅ Font Awesome → cdnjs.cloudflare.com

### Minify Files (Optional):
```bash
# Install terser
npm install -g terser

# Minify JavaScript
terser js/app.js -o js/app.min.js -c -m
terser js/gemini-client.js -o js/gemini-client.min.js -c -m
terser js/pdf-extractor.js -o js/pdf-extractor.min.js -c -m

# Update index.html to use .min.js files
```

---

## Deployment Comparison

| Feature | GitHub Pages | Netlify | Cloudflare | Vercel |
|---------|--------------|---------|------------|--------|
| **Cost** | Free | Free tier | Free | Free tier |
| **Setup Time** | 2 min | 1 min | 3 min | 3 min |
| **Custom Domain** | Yes | Yes | Yes | Yes |
| **HTTPS** | Auto | Auto | Auto | Auto |
| **CDN** | GitHub | Netlify | Cloudflare | Vercel |
| **Build Process** | None | None | None | None |
| **Git Auto-Deploy** | Yes | Yes | Yes | Yes |

**Recommendation:** GitHub Pages (simplest) or Netlify (best UI)

---

## Migration from Old Vercel Deployment

### Redirect Old URL to New:
If you want to keep your old Vercel URL active:

1. Create a simple `index.html` on Vercel:
```html
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="refresh" content="0; url=https://yourusername.github.io/roadmap-json/">
    <title>Redirecting...</title>
</head>
<body>
    <p>Redirecting to new site...</p>
    <p>If not redirected, <a href="https://yourusername.github.io/roadmap-json/">click here</a>.</p>
</body>
</html>
```

2. Or just update your README with new URL

---

## Support & Maintenance

### No Server Maintenance Required! 🎉

**What you DON'T need to do anymore:**
- ❌ Monitor serverless function logs
- ❌ Check API quotas (users manage their own)
- ❌ Update backend dependencies
- ❌ Manage environment variables
- ❌ Debug serverless cold starts
- ❌ Configure function timeouts

**What you DO need to do:**
- ✅ Keep external library CDN URLs updated (PDF.js, Bootstrap)
- ✅ Update README if anything changes
- ✅ Respond to user issues on GitHub

---

## Next Steps

1. **Test locally:** `npx http-server . -p 8080`
2. **Choose hosting:** GitHub Pages recommended
3. **Deploy:** Follow steps above
4. **Update README:** Add your deployment URL
5. **Celebrate!** 🎉 You've eliminated the backend!

---

*Last Updated: 2025-01-16*
*For technical details, see MIGRATION_PLAN.md*
