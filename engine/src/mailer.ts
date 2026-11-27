export interface Mailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Development mailer: logs codes instead of sending them. Replace with SMTP on lighthouse03. */
export class ConsoleMailer implements Mailer {
  sent: { email: string; code: string }[] = [];
  constructor(private log = true) {}
  async sendLoginCode(email: string, code: string): Promise<void> {
    this.sent.push({ email, code });
    if (this.log) console.log(`[mailer] login code for ${email}: ${code}`);
  }
}
