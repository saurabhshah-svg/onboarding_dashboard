// Extract the Email View's email-safe HTML and send it via the Google Apps Script
// (GmailApp). The Email View renders with literal hex colors and table layout
// specifically so its markup can be shipped as an email body — no screenshot,
// no image, no attachment.
// Run by .github/workflows/daily-slack-screenshot.yml.
// Env: EMAIL_REPORT_URL, APPS_SCRIPT_URL, MAIL_SECRET, EMAIL_TO
const { chromium } = require('playwright');

const URL = process.env.EMAIL_REPORT_URL || 'https://spyne-onboarding-dashboard.vercel.app/#email';
const APPS = process.env.APPS_SCRIPT_URL;
const SECRET = process.env.MAIL_SECRET;
const TO = process.env.EMAIL_TO || 'reports@spyne.ai';

async function extractHtml() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 1400 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(
    () => typeof allRows !== 'undefined' && allRows.length > 0 && !!document.querySelector('#email-card'),
    { timeout: 90000 }
  );
  await page.waitForTimeout(1500);
  const html = await page.evaluate(() => document.getElementById('email-card').outerHTML);
  await browser.close();
  if (!html || html.length < 500) throw new Error('Email card HTML looks empty (' + (html ? html.length : 0) + ' chars).');
  return html;
}

(async () => {
  if (!APPS || !SECRET) throw new Error('APPS_SCRIPT_URL and MAIL_SECRET must be set.');
  const card = await extractHtml();
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const html = `<div style="background:#F0F2F5;padding:16px 8px;font-family:Arial,Helvetica,sans-serif">
    ${card}
    <div style="max-width:520px;margin:10px auto 0;text-align:center;font-size:11px;color:#94A3B8">Automated daily snapshot · Spyne Onboarding · <a href="https://spyne-onboarding-dashboard.vercel.app" style="color:#2563EB">Open dashboard</a></div>
  </div>`;

  const res = await fetch(APPS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: SECRET, to: TO,
      subject: 'OB Report — ' + today,
      text: 'OB Report — ' + today + '. Open in an HTML-capable mail client to view the report.',
      html
    })
  });
  const txt = await res.text();
  if (!res.ok || /"error"/.test(txt)) throw new Error('Apps Script email failed: HTTP ' + res.status + ' — ' + txt.slice(0, 200));
  console.log('Emailed OB report (HTML, ' + Math.round(html.length / 1024) + ' KB) to ' + TO + ' via Apps Script.');
})().catch(err => { console.error(err); process.exit(1); });
