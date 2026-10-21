import React from 'react';
import { motion } from 'motion/react';
import { Plus } from 'lucide-react';

export default function LandingPage({ onOpenAuth, onSeeFeatures }) {
  const easeCurve = [0.16, 1, 0.3, 1];

  return (
    <div className="landing-viewport">
      {/* BACKGROUND VIDEO */}
      <motion.div
        className="video-background-wrapper"
        initial={{ opacity: 0, scale: 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.8, ease: easeCurve }}
      >
        <video
          className="background-video-element"
          autoPlay
          muted
          playsInline
          loop
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260508_215831_c6a8989c-d716-4d8d-8745-e972a2eec711.mp4"
        />
      </motion.div>

      {/* FIXED TOP NAVBAR */}
      <motion.nav
        className="landing-navbar"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: easeCurve }}
      >
        {/* Left Side */}
        <div className="navbar-group-left">
          {/* Logo with Two Rotated Rounded Rectangles at -35deg */}
          <div className="navbar-brand">
            <svg
              className="navbar-brand-svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g transform="rotate(-35 12 12)">
                <rect x="5" y="4" width="5.5" height="16" rx="2.75" fill="#000000" />
                <rect x="13.5" y="4" width="5.5" height="16" rx="2.75" fill="#000000" />
              </g>
            </svg>
            <span className="navbar-brand-text">Veyra</span>
          </div>

          {/* Menu Button Pill */}
          <button
            type="button"
            className="navbar-menu-pill"
            onClick={onSeeFeatures}
          >
            <span className="navbar-menu-icon-circle">
              <Plus size={12} strokeWidth={3} color="#000000" />
            </span>
            <span className="navbar-menu-text">Menu</span>
          </button>

          {/* Tags Pill */}
          <div className="navbar-tags-pill">
            <span className="navbar-tag-label">Advanced Bionics</span>
            <span className="navbar-tag-separator">•</span>
            <span className="navbar-tag-label">Cognitive AI</span>
          </div>
        </div>

        {/* Right Side */}
        <div className="navbar-group-right">
          {/* Adaptive Systems Pill */}
          <div className="navbar-systems-pill">
            <span className="navbar-systems-dot-circle">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="2.5" cy="2.5" r="1.2" fill="#ffffff" />
                <circle cx="7.5" cy="2.5" r="1.2" fill="#ffffff" />
                <circle cx="2.5" cy="7.5" r="1.2" fill="#ffffff" />
                <circle cx="7.5" cy="7.5" r="1.2" fill="#ffffff" />
              </svg>
            </span>
            <span className="navbar-systems-text">Adaptive Systems</span>
          </div>

          {/* Access Terminal Button */}
          <button
            type="button"
            className="navbar-auth-pill"
            onClick={() => onOpenAuth('signin')}
          >
            <span>Access Terminal</span>
          </button>
        </div>
      </motion.nav>

      {/* FOOTER CONTENT (OVER WHITE GRADIENT) */}
      <motion.footer
        className="landing-footer-gradient"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.0, delay: 0.5, ease: easeCurve }}
      >
        <div className="landing-footer-container">
          {/* Left Block */}
          <div className="footer-left-block">
            {/* Subtitle with 8px Black Dot */}
            <motion.div
              className="footer-subtitle-row"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.6, ease: easeCurve }}
            >
              <span className="footer-black-dot" />
              <span className="footer-subtitle-text">Best digital banking card 2026</span>
            </motion.div>

            {/* Main Heading */}
            <motion.h1
              className="footer-hero-heading"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.8, ease: easeCurve }}
            >
              One Card, Zero<br />
              Limits. Worldwide.
            </motion.h1>

            {/* Action Buttons */}
            <motion.div
              className="footer-actions-row"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.0, ease: easeCurve }}
            >
              <button
                type="button"
                className="footer-btn-primary"
                onClick={() => onOpenAuth('register')}
              >
                Open Veyra Account
              </button>
              <button
                type="button"
                className="footer-btn-secondary"
                onClick={onSeeFeatures}
              >
                How It Works
              </button>
            </motion.div>
          </div>

          {/* Right Block: Three Tag Pills */}
          <div className="footer-right-block">
            <span className="footer-tag-pill">Neuromorphic</span>
            <span className="footer-tag-pill">AGI</span>
            <span className="footer-tag-pill">Cybernetics</span>
          </div>
        </div>
      </motion.footer>
    </div>
  );
}
