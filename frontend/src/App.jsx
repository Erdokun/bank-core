import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthOtpModal from './components/AuthOtpModal';
import Dashboard from './components/Dashboard';
import './App.css';

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'dashboard'
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState('signin');
  const [toasts, setToasts] = useState([]);

  // Check saved session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('veyra_token') || localStorage.getItem('token');
    if (savedToken) {
      validateSession(savedToken);
    }
  }, []);

  const validateSession = async (authToken) => {
    try {
      const res = await fetch('/auth/me', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        setToken(authToken);
        setView('dashboard');
      } else {
        localStorage.removeItem('veyra_token');
        localStorage.removeItem('token');
      }
    } catch (e) {
      console.error('Session validation error:', e);
    }
  };

  const handleOpenAuth = (mode = 'signin') => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
  };

  const handleAuthSuccess = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('veyra_token', newToken);
    localStorage.setItem('token', newToken);
    setView('dashboard');
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('veyra_token');
    localStorage.removeItem('token');
    setView('landing');
    showToast('Signed Out', 'Your Veyra session has been safely concluded.', 'info');
  };

  const showToast = (title, message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, title, message, type, duration }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="app-root">
      {/* TOAST NOTIFICATION CONTAINER */}
      <div className="toast-portal">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast-item">
            <div className="toast-icon">
              {toast.type === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : toast.type === 'aml' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              )}
            </div>
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => removeToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* VIEW SWITCHER: LANDING vs DASHBOARD */}
      {view === 'landing' ? (
        <LandingPage
          onOpenAuth={handleOpenAuth}
          onSeeFeatures={() => {
            if (token) {
              setView('dashboard');
            } else {
              handleOpenAuth('signin');
            }
          }}
        />
      ) : (
        <Dashboard
          user={user}
          token={token}
          onLogout={handleLogout}
          onReturnToShowcase={() => setView('landing')}
          showToast={showToast}
        />
      )}

      {/* AUTH & OTP ONBOARDING MODAL */}
      <AuthOtpModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
        onAuthSuccess={handleAuthSuccess}
        showToast={showToast}
      />
    </div>
  );
}
