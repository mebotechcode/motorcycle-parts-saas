# Update: email invitations, mobile menu, new landing page

## A. See the new website (no setup needed)
1. Stop the website if it is running (Ctrl + C in its window).
2. Replace your project files with the new zip (Extract All → choose **Replace**).
3. In the black window in `apps\web` run: `npm run dev`
4. Open http://localhost:3000. You now see the new landing page. Make the browser window narrow (or use your phone, see C) and tap the **☰** menu.

Edit your contact email and the prices shown to visitors at the top of `apps\web\src\app\page.tsx`
(`CONTACT_EMAIL` and `PLANS`).

## B. Turn on email invitations (one time)
Emails are sent through Brevo (free: 300 emails a day).

1. Create a free account at **brevo.com**.
2. **Add a sender:** in Brevo go to *Senders, Domains & Dedicated IPs → Senders → Add a sender*.
   Use a real email address you can open (for example your Gmail). Brevo emails you a code or link. Confirm it.
3. **Get an API key:** click your name (top right) → **SMTP & API → API Keys → Generate a new API key**. Copy it (it starts with `xkeysib-`).
4. Open a terminal in the **main** folder `motorcycle-parts-saas` and run this as ONE line, with your own values:
```
npx supabase secrets set BREVO_API_KEY=xkeysib-PASTE-YOURS MAIL_FROM_EMAIL=you@gmail.com MAIL_FROM_NAME="NafPOS" APP_URL=http://localhost:3000
```
5. Deploy the email function:
```
npx supabase functions deploy send-invite --no-verify-jwt
```
   (If it complains about Docker, run it again with `--use-api` added at the end.)
6. Test it: **Staff → Invite someone** → your other email → **Send invitation**. Check the inbox (and spam).

Important: `APP_URL=http://localhost:3000` means the link in the email only opens on **your own computer**.
Once the website is hosted online, run the `secrets set` command again with `APP_URL=https://your-real-website-address`.

If email is not set up, or the function is not deployed, the app still creates the invite and shows the link
with a WhatsApp button, so nothing is blocked.

## C. Open the site on your phone (same Wi-Fi)
1. Stop the website (Ctrl + C) and start it this way: `npm run dev:lan`
2. In another black window type `ipconfig` and find **IPv4 Address** (looks like 192.168.1.23).
3. On your phone's browser open `http://192.168.1.23:3000` (use your own number).
4. If Windows shows a firewall question, click **Allow**.
This works only while your phone and computer are on the same Wi-Fi. To open it from anywhere, the website must be put online (next step).

## Troubleshooting
| Problem | Fix |
|---|---|
| Message says the email was not sent | Read the reason shown. Most often the sender is not verified in Brevo, or the API key was pasted wrongly |
| Reason mentions "unauthorised IP" | Brevo → Security → Authorised IPs → turn the blocking off |
| Invite shows a link but no email | The function is not deployed yet (step B5) or secrets are missing (B4) |
| Email lands in spam | Normal when using a Gmail sender. Fixed later by sending from your own domain |
