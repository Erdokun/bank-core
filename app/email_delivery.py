"""Validated SMTP transport. Credentials stay in the server environment."""
import argparse
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


def deliver(message: EmailMessage, config: SmtpConfig):
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
        refused = server.send_message(message, from_addr=parseaddr(config.sender)[1])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def main():
    parser = argparse.ArgumentParser(description="Validate Veyra SMTP configuration without sending email or printing credentials.")
    parser.parse_args()
    try:
        config = SmtpConfig.from_environment()
    except ValueError as error:
        print(f"Email configuration needs attention: {error}")
        raise SystemExit(1) from None
    transport = "SSL" if config.use_ssl else "STARTTLS" if config.use_tls else "local plaintext"
    print(f"SMTP configuration valid: {config.host}:{config.port} ({transport}).")
    print("No message sent. Request an account verification code to check inbox delivery.")


if __name__ == "__main__":
    main()
