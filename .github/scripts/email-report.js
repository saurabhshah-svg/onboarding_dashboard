// Screenshot the Email View and email it (inline + attached) via SMTP.
// Run by .github/workflows/daily-slack-screenshot.yml.
// Env: EMAIL_REPORT_URL, EMAIL_TO, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, [SMTP_FROM]
const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const URL = process.env.EMAIL_REPORT_URL || 'https://spyne-onboarding-dashboard.vercel.app/#email';
const TO = process.env.EMAIL_TO || 'reports@spyne.ai';
const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

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
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set.');
  const buf = await capture();
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await transport.sendMail({
    from: SMTP_FROM,
    to: TO,
    subject: 'OB Report — ' + today,
    text: 'OB Report — ' + today + '. See the attached / inline image.',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#0F172A">
      <p style="font-size:15px">📊 <b>OB Report — ${today}</b></p>
      <img src="cid:obreport" alt="OB Report" style="max-width:100%;border:1px solid #E2E8F0;border-radius:10px"/>
      <p style="font-size:12px;color:#64748B">Automated daily snapshot · Spyne Onboarding</p>
    </div>`,
    attachments: [{ filename: 'ob-report-' + today.replace(/ /g,'-') + '.png', content: buf, cid: 'obreport' }]
  });
  console.log('Emailed OB report to ' + TO);
})().catch(err => { console.error(err); process.exit(1); });
