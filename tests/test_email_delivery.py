"""No external messages: transport boundaries are mocked in all tests here."""
from email.message import EmailMessage
from unittest.mock import MagicMock
import pytest
from app.email_delivery import SmtpConfig, deliver


@pytest.fixture
def gmail(monkeypatch):
    values = {"SMTP_HOST": "smtp.gmail.com", "SMTP_PORT": "587", "SMTP_FROM": "Veyra <sender@gmail.com>", "SMTP_USER": "sender@gmail.com", "SMTP_PASSWORD": "abcd efgh ijkl mnop", "SMTP_TLS": "true", "SMTP_SSL": "false"}
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return values


def test_gmail_uses_app_password_without_display_spaces(gmail):
    config = SmtpConfig.from_environment()
    assert config.password == "abcdefghijklmnop"
    assert config.use_tls and not config.use_ssl
    assert config.password not in repr(config) and config.username not in repr(config)


@pytest.mark.parametrize("changes", [{"SMTP_TLS": "false"}, {"SMTP_PASSWORD": ""}, {"SMTP_FROM": "Veyra <no-reply@veyra.local>"}, {"SMTP_PORT": "1025"}, {"SMTP_PORT": "oops"}, {"SMTP_FROM": "sender@gmail.com\nBcc: other@example.com"}, {"SMTP_SSL": "true"}])
def test_gmail_rejects_incomplete_or_insecure_configuration(gmail, monkeypatch, changes):
    for key, value in changes.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(ValueError):
        SmtpConfig.from_environment()


def test_starttls_happens_before_authentication(gmail, monkeypatch):
    factory = MagicMock()
    server = factory.return_value.__enter__.return_value
    server.send_message.return_value = {}
    monkeypatch.setattr("app.email_delivery.smtplib.SMTP", factory)
    message = EmailMessage()
    message["To"] = "recipient@example.com"
    deliver(message, SmtpConfig.from_environment())
    calls = [call[0] for call in server.method_calls]
    assert calls == ["ehlo", "starttls", "ehlo", "login", "send_message"]
    assert server.starttls.call_args.kwargs["context"].check_hostname
    assert server.send_message.call_args.kwargs["from_addr"] == "sender@gmail.com"


def test_implicit_ssl_validates_certificate(gmail, monkeypatch):
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_SSL", "true")
    monkeypatch.setenv("SMTP_TLS", "false")
    factory = MagicMock()
    server = factory.return_value.__enter__.return_value
    server.send_message.return_value = {}
    monkeypatch.setattr("app.email_delivery.smtplib.SMTP_SSL", factory)
    deliver(EmailMessage(), SmtpConfig.from_environment())
    assert factory.call_args.kwargs["context"].check_hostname
    server.starttls.assert_not_called()
    server.login.assert_called_once()


def test_refused_recipient_is_not_reported_as_dispatched(gmail, monkeypatch):
    import smtplib
    factory = MagicMock()
    factory.return_value.__enter__.return_value.send_message.return_value = {"recipient@example.com": (550, b"Refused")}
    monkeypatch.setattr("app.email_delivery.smtplib.SMTP", factory)
    with pytest.raises(smtplib.SMTPRecipientsRefused):
        deliver(EmailMessage(), SmtpConfig.from_environment())


def test_cli_connection_check_authenticates_without_sending(gmail, monkeypatch, capsys):
    from app.email_delivery import main
    factory = MagicMock()
    monkeypatch.setattr('app.email_delivery.smtplib.SMTP', factory)
    monkeypatch.setattr('sys.argv', ['email_delivery', '--check-connection'])
    main()
    server = factory.return_value.__enter__.return_value
    server.login.assert_called_once()
    server.send_message.assert_not_called()
    assert 'authentication succeeded' in capsys.readouterr().out


def test_cli_never_prints_raw_authentication_errors_or_credentials(gmail, monkeypatch, capsys):
    import smtplib
    from app.email_delivery import main
    factory = MagicMock()
    factory.return_value.__enter__.return_value.login.side_effect = smtplib.SMTPAuthenticationError(535, b'secret-must-stay-private')
    monkeypatch.setattr('app.email_delivery.smtplib.SMTP', factory)
    monkeypatch.setattr('sys.argv', ['email_delivery', '--check-connection'])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 1
    output = capsys.readouterr().out
    assert 'secret-must-stay-private' not in output and 'abcdefghijklmnop' not in output
    assert 'SMTP login rejected' in output
