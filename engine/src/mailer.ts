import nodemailer, { type Transporter } from "nodemailer";

export interface Mailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Development mailer: logs codes instead of sending them. */
export class ConsoleMailer implements Mailer {
  sent: { email: string; code: string }[] = [];
  constructor(private log = true) {}
  async sendLoginCode(email: string, code: string): Promise<void> {
    this.sent.push({ email, code });
    if (this.log) console.log(`[mailer] login code for ${email}: ${code}`);
  }
}

/** The login email, in Greek first and English below, since we don't know the reader's language yet. */
export function loginCodeMessage(code: string) {
  const subject = `Κωδικός σύνδεσης ${code} · Login code`;
  const text = [
    `Ο κωδικός σύνδεσής σας στο Rural Greece είναι: ${code}`,
    "Ισχύει για 10 λεπτά. Αν δεν τον ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.",
    "",
    `Your Rural Greece login code is: ${code}`,
    "It is valid for 10 minutes. If you didn't ask for it, you can ignore this email.",
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;color:#1c2c23;max-width:480px">
<p>Ο κωδικός σύνδεσής σας στο <b>Rural Greece</b>:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px;color:#376245">${code}</p>
<p>Ισχύει για 10 λεπτά. Αν δεν τον ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.</p>
<hr style="border:none;border-top:1px solid #E1E5DF">
<p style="color:#5E6B63">Your Rural Greece login code is <b>${code}</b>. It is valid for 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`;
  return { subject, text, html };
}

/** SMTP mailer, configured with a URL such as smtps://user:pass@mail.example.gr:465 */
export class SmtpMailer implements Mailer {
  private transport: Transporter;
  constructor(
    url: string,
    private from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async sendLoginCode(email: string, code: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: email, ...loginCodeMessage(code) });
  }
}
