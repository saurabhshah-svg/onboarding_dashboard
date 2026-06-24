// Screenshot the deployed Email View and upload it as an image to a Slack channel.
// Run by .github/workflows/daily-slack-screenshot.yml (daily) or manually.
// Env: REPORT_URL, SLACK_BOT_TOKEN, SLACK_CHANNEL_ID
const { chromium } = require('playwright');

const REPORT_URL = process.env.REPORT_URL || 'https://spyne-onboarding-dashboard.vercel.app/#email';
const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;

async function capture() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 1400 }, deviceScaleFactor: 2 });
  await page.goto(REPORT_URL, { waitUntil: 'networkidle', timeout: 90000 });
  // Make sure we're on the Email View and the live data has rendered
  // Wait until live data has loaded and the report card is rendered
  await page.waitForFunction(
    () => typeof allRows !== 'undefined' && allRows.length > 0 && !!document.querySelector('#email-card'),
    { timeout: 90000 }
  );
  await page.waitForTimeout(2500); // let fonts/layout settle
  const el = await page.$('#email-card');
  const buf = await el.screenshot();
  await browser.close();
  return buf;
}

async function slackUpload(buf) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  // 1) reserve an upload URL
  const g = await (await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ filename: 'ob-report.png', length: String(buf.length) })
  })).json();
  if (!g.ok) throw new Error('getUploadURLExternal failed: ' + JSON.stringify(g));

  // 2) upload the bytes
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), 'ob-report.png');
  const put = await fetch(g.upload_url, { method: 'POST', body: form });
  if (!put.ok) throw new Error('file upload failed: HTTP ' + put.status);

  // 3) finalize + share to the channel
  const c = await (await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ id: g.file_id, title: 'OB Report — ' + today }],
      channel_id: CHANNEL,
      initial_comment: ':bar_chart: *OB Report — ' + today + '*'
    })
  })).json();
  if (!c.ok) throw new Error('completeUploadExternal failed: ' + JSON.stringify(c));
  console.log('Posted OB report screenshot to Slack.');
}

(async () => {
  if (!TOKEN || !CHANNEL) throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set.');
  const buf = await capture();
  await slackUpload(buf);
})().catch(err => { console.error(err); process.exit(1); });
