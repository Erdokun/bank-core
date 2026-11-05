"""Validated SMTP transport. Credentials stay in the server environment."""
import argparse
from contextlib import contextmanager
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import parseaddr
import os
import smtplib
import ssl


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    sender: str = field(repr=False)
    username: str = field(repr=False)
    password: str = field(repr=False)
    use_ssl: bool = False
    use_tls: bool = True

    @classmethod
    def from_environment(cls):
        host = os.getenv("SMTP_HOST", "").strip()
        if not host:
            raise ValueError("SMTP_HOST is not configured")
        use_ssl = os.getenv("SMTP_SSL", "false").lower() == "true"
        use_tls = os.getenv("SMTP_TLS", "true").lower() == "true"
        try:
            port = int(os.getenv("SMTP_PORT", "465" if use_ssl else "587"))
        except ValueError:
            raise ValueError("SMTP_PORT must be a valid port") from None
        if not 1 <= port <= 65535:
            raise ValueError("SMTP_PORT must be between 1 and 65535")
        if use_ssl and use_tls:
            raise ValueError("Choose implicit SSL or STARTTLS, not both")
        username = os.getenv("SMTP_USER", "").strip()
        password = os.getenv("SMTP_PASSWORD", "")
        sender = os.getenv("SMTP_FROM", "Veyra <no-reply@veyra.local>").strip()
        if any(c in sender for c in "\r\n") or "@" not in parseaddr(sender)[1]:
            raise ValueError("SMTP_FROM must be a valid sender address")
        if username and not password:
            raise ValueError("SMTP_PASSWORD is required with SMTP_USER")
        if host.lower() == "smtp.gmail.com":
            password = "".join(password.split())
            if not username or "@" not in username or not password:
                raise ValueError("Gmail requires SMTP_USER and a Google app password")
            if not ((use_ssl and port == 465) or (use_tls and not use_ssl and port == 587)):
                raise ValueError("Gmail requires port 587 with STARTTLS or port 465 with SSL")
            if parseaddr(sender)[1].lower() != username.lower():
                raise ValueError("For Gmail, set SMTP_FROM to the authenticated SMTP_USER address")
        return cls(host, port, sender, username, password, use_ssl, use_tls)


@contextmanager
def authenticated_connection(config: SmtpConfig):
    context = ssl.create_default_context()
    if config.use_ssl:
        connection = smtplib.SMTP_SSL(config.host, config.port, timeout=12, context=context)
    else:
        connection = smtplib.SMTP(config.host, config.port, timeout=12)
    with connection as server:
        server.ehlo()
        if config.use_tls and not config.use_ssl:
            server.starttls(context=context)
            server.ehlo()
        if config.username:
            server.login(config.username, config.password)
        yield server


def deliver(message: EmailMessage, config: SmtpConfig):
    with authenticated_connection(config) as server:
        refused = server.send_message(message, from_addr=parseaddr(config.sender)[1])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def main():
    parser = argparse.ArgumentParser(description="Check Veyra SMTP without printing credentials.")
    parser.add_argument('--check-connection', action='store_true', help='Connect with TLS and authenticate without sending mail.')
    parser.add_argument('--send-test', action='store_true', help='Send a delivery check only to the configured sender address.')
    args = parser.parse_args()
    try:
        config = SmtpConfig.from_environment()
    except ValueError as error:
        print(f"Email configuration needs attention: {error}")
        raise SystemExit(1) from None
    transport = "SSL" if config.use_ssl else "STARTTLS" if config.use_tls else "local plaintext"
    print(f"SMTP configuration valid: {config.host}:{config.port} ({transport}).")
    try:
        if args.send_test:
            message = EmailMessage()
            message['From'] = config.sender
            message['To'] = parseaddr(config.sender)[1]
            message['Subject'] = 'Veyra Gmail bağlantısı hazır'
            message.set_content('Veyra e-posta gönderim testi başarılı.\n\nGmail bağlantınız kuruldu. Artık uygulamadan isteyeceğiniz doğrulama kodları bu bağlantı üzerinden gönderilecek.\nBu yalnızca bir bağlantı testidir; hesabınızda herhangi bir değişiklik yapılmadı.\n\nVeyra')
            deliver(message, config)
            print('Test message accepted by SMTP for the configured sender. Check Inbox and Spam to confirm arrival.')
        elif args.check_connection:
            with authenticated_connection(config):
                pass
            print('TLS connection and SMTP authentication succeeded. No message sent.')
        else:
            print('No connection attempted. Use --check-connection to verify SMTP login or --send-test for an inbox check.')
    except smtplib.SMTPAuthenticationError:
        print('SMTP login rejected. Check the sender address and Google app password in .env, then recreate the API container.')
        raise SystemExit(1) from None
    except (OSError, smtplib.SMTPException):
        print('SMTP connection or delivery failed. Check network access and SMTP host, port and TLS settings. No credentials were logged.')
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
