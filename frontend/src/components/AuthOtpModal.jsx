import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

export default function AuthOtpModal({ isOpen, onClose, initialMode = 'signin', onAuthSuccess, showToast }) {
  const [mode, setMode] = useState(initialMode); // 'signin' | 'register'
  const [step, setStep] = useState(1); // 1: Credentials, 2: OTP Entry
  
  // Form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('user@veyra.com');
  const [password, setPassword] = useState('VeyraPassword123!');
  
  // OTP state
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpTimer, setOtpTimer] = useState(300);
  const [isLoading, setIsLoading] = useState(false);
  const [devOtp, setDevOtp] = useState(null);
  const [emailHtmlPreview, setEmailHtmlPreview] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const otpInputsRef = useRef([]);

  useEffect(() => {
    setMode(initialMode);
    setStep(1);
    setOtpDigits(['', '', '', '', '', '']);
  }, [initialMode, isOpen]);

  // Countdown timer for OTP
  useEffect(() => {
    let interval = null;
    if (step === 2 && otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, otpTimer]);

  if (!isOpen) return null;

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Step 1: Dispatch OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      showToast('Validation Error', 'Email and password are required.', 'error');
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      showToast('Validation Error', 'Legal full name is required for account opening.', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Could not dispatch verification code.');
      }

      setDevOtp(data.dev_otp);
      setEmailHtmlPreview(data.html_preview);
      setStep(2);
      setOtpTimer(300);
      showToast('Verification Code Sent', `Single-use security key dispatched to ${email}.`, 'success');

      // Auto focus first OTP input
      setTimeout(() => {
        if (otpInputsRef.current[0]) otpInputsRef.current[0].focus();
      }, 150);

    } catch (err) {
      showToast('Dispatch Failed', err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle individual digit input
  const handleDigitChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;

    const newDigits = [...otpDigits];
    newDigits[index] = value.slice(-1);
    setOtpDigits(newDigits);

    // Auto advance to next box
    if (value && index < 5 && otpInputsRef.current[index + 1]) {
      otpInputsRef.current[index + 1].focus();
    }

    // Auto submit if all 6 digits entered
    const completeCode = newDigits.join('');
    if (completeCode.length === 6) {
      verifyCode(completeCode);
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...otpDigits];
    pasted.split('').forEach((char, i) => {
      newDigits[i] = char;
    });
    setOtpDigits(newDigits);

    if (pasted.length === 6) {
      verifyCode(pasted);
    } else if (otpInputsRef.current[pasted.length]) {
      otpInputsRef.current[pasted.length].focus();
    }
  };

  // Step 2: Verify Code
  const verifyCode = async (codeToVerify) => {
    const code = codeToVerify || otpDigits.join('');
    if (code.length !== 6) {
      showToast('Invalid Code', 'Please enter all 6 digits.', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code,
          password: password,
          full_name: fullName.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Verification code rejected.');
      }

      showToast('Identity Verified', 'Cryptographic token generated. Entering terminal...', 'success');
      onAuthSuccess(data.access_token, data.user);
      onClose();

    } catch (err) {
      showToast('Verification Failed', err.message, 'error');
      setOtpDigits(['', '', '', '', '', '']);
      if (otpInputsRef.current[0]) otpInputsRef.current[0].focus();
    } finally {
      setIsLoading(false);
    }
  };

  const fillQuickDemo = () => {
    setFullName('Erdem Celik');
    setEmail('erdem@bank.de');
    setPassword('StrongPass123!');
    showToast('Demo Credentials Loaded', 'Ready to request verification key.', 'info');
  };

  return (
    <>
      <div className="auth-modal-backdrop" onClick={onClose}>
        <motion.div
          className="auth-modal-card"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Close Button */}
          <button type="button" className="auth-modal-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Brand Header */}
          <div className="auth-header">
            <div className="auth-brand-monogram">
              <img src="/veyra-logo.png" alt="Veyra" className="auth-brand-img" />
            </div>
            <h2 className="auth-title">
              {step === 1
                ? mode === 'signin'
                  ? 'Access Veyra Terminal'
                  : 'Open Private Wealth Account'
                : 'Security Verification'}
            </h2>
            <p className="auth-subtitle">
              {step === 1
                ? 'Ultra-high concurrency ledger and private banking core.'
                : `Enter the 6-digit cryptographic key sent to ${email}`}
            </p>
          </div>

          {step === 1 ? (
            /* STEP 1: CREDENTIALS */
            <div>
              {/* Tab Selector */}
              <div className="auth-tab-group">
                <button
                  type="button"
                  className={`auth-tab-btn ${mode === 'signin' ? 'active' : ''}`}
                  onClick={() => setMode('signin')}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className={`auth-tab-btn ${mode === 'register' ? 'active' : ''}`}
                  onClick={() => setMode('register')}
                >
                  Open Account
                </button>
              </div>

              <form onSubmit={handleRequestOtp} className="auth-form-fields">
                {mode === 'register' && (
                  <div className="auth-field">
                    <label className="auth-label">Legal Full Name</label>
                    <input
                      type="text"
                      className="auth-input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Erdem Celik"
                      required
                    />
                  </div>
                )}

                <div className="auth-field">
                  <label className="auth-label">Work / Personal Email</label>
                  <input
                    type="email"
                    className="auth-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@veyra.com"
                    required
                  />
                </div>

                <div className="auth-field">
                  <label className="auth-label">Passphrase</label>
                  <input
                    type="password"
                    className="auth-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="auth-btn-submit"
                >
                  {isLoading ? 'Generating OTP...' : 'Send Verification Code'}
                </button>
              </form>

              {/* Demo Helper Pill */}
              <div className="auth-demo-footer">
                <span className="auth-demo-label">Instant Test Account:</span>
                <button
                  type="button"
                  onClick={fillQuickDemo}
                  className="auth-demo-btn"
                >
                  Fill Demo User
                </button>
              </div>
            </div>
          ) : (
            /* STEP 2: 6-BOX OTP VERIFICATION */
            <div className="auth-otp-wrapper">
              {/* 6 Digit Input Boxes */}
              <div className="otp-boxes-row" onPaste={handlePaste}>
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (otpInputsRef.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otp-digit-box"
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                  />
                ))}
              </div>

              {/* Dev Helper Pill showing code directly */}
              {devOtp && (
                <div className="otp-dev-badge">
                  <span>Dev Dispatch Key:</span>
                  <strong className="otp-dev-code">{devOtp}</strong>
                  <button
                    type="button"
                    className="otp-dev-copy-btn"
                    onClick={() => {
                      setOtpDigits(devOtp.split(''));
                      verifyCode(devOtp);
                    }}
                  >
                    Auto-Fill
                  </button>
                </div>
              )}

              {/* Timer & Resend */}
              <div className="otp-status-row">
                <span className="otp-timer">Expires in: {formatTimer(otpTimer)}</span>
                <button
                  type="button"
                  className="otp-resend-btn"
                  onClick={handleRequestOtp}
                  disabled={isLoading}
                >
                  Resend Key
                </button>
              </div>

              {/* Verify Button */}
              <button
                type="button"
                className="auth-btn-submit"
                onClick={() => verifyCode()}
                disabled={isLoading}
              >
                {isLoading ? 'Verifying...' : 'Authorize & Enter Dashboard'}
              </button>

              {/* Email Preview Drawer Trigger */}
              {emailHtmlPreview && (
                <div className="otp-preview-row">
                  <button
                    type="button"
                    className="otp-view-email-btn"
                    onClick={() => setShowEmailModal(true)}
                  >
                    View Delivered Security Email
                  </button>
                </div>
              )}

              {/* Back to Step 1 */}
              <button
                type="button"
                className="otp-back-link"
                onClick={() => setStep(1)}
              >
                Change Email / Back
              </button>
            </div>
          )}
        </motion.div>
      </div>

      {/* EMAIL PREVIEW MODAL */}
      <AnimatePresence>
        {showEmailModal && (
          <div className="email-preview-backdrop" onClick={() => setShowEmailModal(false)}>
            <motion.div
              className="email-preview-card"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              <div className="email-preview-header">
                <div className="email-preview-meta">
                  <span className="email-from">From: no-reply@veyra.com</span>
                  <span className="email-subject">Subject: Verification Code</span>
                </div>
                <button
                  type="button"
                  className="email-preview-close"
                  onClick={() => setShowEmailModal(false)}
                >
                  Close Preview
                </button>
              </div>
              <div
                className="email-preview-body"
                dangerouslySetInnerHTML={{ __html: emailHtmlPreview }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
