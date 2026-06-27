// Screenshot the Email View and email it via the Google Apps Script (GmailApp).
// Run by .github/workflows/daily-slack-screenshot.yml.
// Env: EMAIL_REPORT_URL, APPS_SCRIPT_URL, MAIL_SECRET, EMAIL_TO
const { chromium } = require('playwright');

const URL = process.env.EMAIL_REPORT_URL || 'https://spyne-onboarding-dashboard.vercel.app/#email';
const APPS = process.env.APPS_SCRIPT_URL;
const SECRET = process.env.MAIL_SECRET;
const TO = process.env.EMAIL_TO || 'reports@spyne.ai';

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(
    () => typeof allRows !== 'undefined' && allRows.length > 0 && !!document.querySelector('#email-card'),
    { timeout: 90000 }
  );
  await page.waitForTimeout(2500);
  const buf = await (await page.$('#email-card')).screenshot();
  await browser.close();
  return buf;
}

(async () => {
  if (!APPS || !SECRET) throw new Error('APPS_SCRIPT_URL and MAIL_SECRET must be set.');
  const buf = await capture();
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A">
    <p style="font-size:15px">📊 <b>OB Report — ${today}</b></p>
    <img src="cid:obreport" alt="OB Report" style="max-width:100%;border:1px solid #E2E8F0;border-radius:10px"/>
    <p style="font-size:12px;color:#64748B">Automated daily snapshot · Spyne Onboarding</p>
  </div>`;

  const res = await fetch(APPS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: SECRET, to: TO,
      subject: 'OB Report — ' + today,
      text: 'OB Report — ' + today + '. See the attached / inline image.',
      html, png: buf.toString('base64'),
      filename: 'ob-report-' + today.replace(/ /g, '-') + '.png'
    })
  });
  const txt = await res.text();
  if (!res.ok || /"error"/.test(txt)) throw new Error('Apps Script email failed: HTTP ' + res.status + ' — ' + txt.slice(0, 200));
  console.log('Emailed OB report to ' + TO + ' via Apps Script.');
})().catch(err => { console.error(err); process.exit(1); });
