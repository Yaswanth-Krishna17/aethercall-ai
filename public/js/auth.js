document.addEventListener('DOMContentLoaded', () => {
  // Tab Elements
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginContainer = document.getElementById('login-container');
  const registerContainer = document.getElementById('register-container');

  // Form Elements
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  // Error/Success Elements
  const loginError = document.getElementById('login-error');
  const regError = document.getElementById('reg-error');
  const regSuccess = document.getElementById('reg-success');

  // Google Login Elements
  const btnGoogleLogin = document.getElementById('btn-google-login');

  // OTP Verification Elements
  const otpModal = document.getElementById('otp-modal');
  const otpTargetEmail = document.getElementById('otp-target-email');
  const otpDigits = document.querySelectorAll('.otp-input-digit');
  const otpError = document.getElementById('otp-error');
  const btnCancelOtp = document.getElementById('btn-cancel-otp');
  const btnVerifyOtp = document.getElementById('btn-verify-otp');
  const smtpToast = document.getElementById('smtp-toast');
  const smtpToastText = document.getElementById('smtp-toast-text');

  // In-Memory cache for registration details during OTP stage
  let pendingRegistration = null;

  // --- 1. Session Redirect Verification ---
  async function checkActiveSession() {
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        window.location.href = 'dashboard.html';
      }
    } catch (err) {
      console.warn('Session verification bypassed or failed.', err);
    }
  }
  checkActiveSession();

  // --- 2. Tab Switching Logic ---
  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    tabRegister.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'false');
    
    loginContainer.classList.add('active');
    registerContainer.classList.remove('active');
    
    // Reset alerts
    loginError.style.display = 'none';
    regError.style.display = 'none';
    regSuccess.style.display = 'none';
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabRegister.setAttribute('aria-selected', 'true');
    tabLogin.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'false');
    
    registerContainer.classList.add('active');
    loginContainer.classList.remove('active');

    loginError.style.display = 'none';
    regError.style.display = 'none';
    regSuccess.style.display = 'none';
  });

  // --- 3. Google OAuth Pop-up & Relayer ---
  btnGoogleLogin.addEventListener('click', () => {
    const width = 500;
    const height = 620;
    const left = (screen.width / 2) - (width / 2);
    const top = (screen.height / 2) - (height / 2);
    
    // Launch borderless mock accounts chooser popup window
    window.open('google-auth-mock.html', 'GoogleSignIN', 
      `width=${width},height=${height},left=${left},top=${top},scrollbars=no,resizable=no`
    );
  });

  // Listen for secure OAuth postMessage from child popup
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'google-login-success') {
      const { fullName, email } = event.data;
      console.log(`[GOOGLE-OAUTH] Received token payload for: ${fullName} (${email})`);

      try {
        const res = await fetch('/api/login/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName, email })
        });

        const data = await res.json();
        if (res.ok) {
          // Authentication cookie accepted, redirect instantly to dashboard
          window.location.href = 'dashboard.html';
        } else {
          showError(loginError, data.error || 'Google login verification failed.');
        }
      } catch (err) {
        showError(loginError, 'Google login server connection failure.');
      }
    }
  });

  // --- 4. Login Submission ---
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
      showError(loginError, 'Please enter both your username and password.');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        showError(loginError, data.error || 'Authentication failed.');
      } else {
        window.location.href = 'dashboard.html';
      }
    } catch (err) {
      showError(loginError, 'Server unreachable. Please try again later.');
    }
  });

  // --- 5. Registration Form & OTP Activation ---
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    regError.style.display = 'none';
    regSuccess.style.display = 'none';

    const fullName = document.getElementById('reg-fullname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!fullName || !email || !username || !password) {
      showError(regError, 'All registration fields are required.');
      return;
    }

    if (password.length < 6) {
      showError(regError, 'Password must be at least 6 characters long.');
      return;
    }

    if (!/^[a-zA-Z0-9]+$/.test(username)) {
      showError(regError, 'Username must be alphanumeric (letters and numbers only).');
      return;
    }

    const submitBtn = registerForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Sign Up';

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Sending Code...';
      }

      // Request secure OTP code from backend
      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, type: 'register' })
      });

      const data = await res.json();

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }

      if (!res.ok) {
        showError(regError, data.error || 'Failed to dispatch verification code.');
        return;
      }

      // Cache the pending registration fields in memory (excluding code)
      pendingRegistration = {
        fullName,
        email,
        username,
        password
      };

      if (data.simulated) {
        // Trigger SMTP Mailer Toast Notification with simulated OTP code
        const otpCode = data.otp;
        smtpToastText.innerHTML = `Secure verification code <strong style="color:#fff; font-size:0.9rem; letter-spacing:1px;">[ ${otpCode.slice(0,3)}-${otpCode.slice(3)} ]</strong> sent to <strong>${email}</strong>!`;
      } else {
        // Real email dispatched successfully
        smtpToastText.innerHTML = `📨 Verification email sent! Please check your inbox (and spam folder) for <strong>${email}</strong>.`;
      }
      smtpToast.classList.add('active');

      // Display Glassmorphic OTP Shield Overlay
      otpTargetEmail.textContent = email;
      otpError.style.display = 'none';
      resetOTPIntensity();
      otpModal.classList.add('active');

      // Trigger initial autofocus in the first OTP cell
      setTimeout(() => {
        otpDigits[0].focus();
      }, 100);

    } catch (err) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
      showError(regError, 'Failed to connect to the server. Please try again.');
    }
  });

  // --- 6. 6-Digit Auto-Focus Digit Shifting State Machine ---
  otpDigits.forEach((input, index) => {
    // Focus next cell as digits are input
    input.addEventListener('input', (e) => {
      const val = input.value;
      if (!/^[0-9]$/.test(val)) {
        input.value = '';
        return;
      }

      if (index < otpDigits.length - 1) {
        otpDigits[index + 1].removeAttribute('disabled');
        otpDigits[index + 1].focus();
      }
    });

    // Handle backspace shifting focus back
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (input.value === '') {
          if (index > 0) {
            otpDigits[index].setAttribute('disabled', 'true');
            otpDigits[index - 1].focus();
            otpDigits[index - 1].value = '';
          }
        } else {
          input.value = '';
        }
      }
    });
  });

  function resetOTPIntensity() {
    otpDigits.forEach((input, idx) => {
      input.value = '';
      if (idx > 0) input.setAttribute('disabled', 'true');
    });
  }

  // Dismiss OTP Overlay
  btnCancelOtp.addEventListener('click', () => {
    otpModal.classList.remove('active');
    smtpToast.classList.remove('active');
    pendingRegistration = null;
  });

  // Submit and verify OTP
  btnVerifyOtp.addEventListener('click', handleOTPVerificationSubmit);

  async function handleOTPVerificationSubmit() {
    otpError.style.display = 'none';
    if (!pendingRegistration) return;

    let typedCode = '';
    otpDigits.forEach(input => typedCode += input.value);

    if (typedCode.length < 6) {
      otpError.textContent = 'Please enter all 6 verification digits.';
      otpError.style.display = 'flex';
      return;
    }

    try {
      btnVerifyOtp.disabled = true;
      const originalText = btnVerifyOtp.textContent;
      btnVerifyOtp.textContent = 'Verifying...';

      const verifyRes = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingRegistration.email, otp: typedCode })
      });

      const verifyData = await verifyRes.json();
      btnVerifyOtp.disabled = false;
      btnVerifyOtp.textContent = originalText;

      if (!verifyRes.ok) {
        otpError.textContent = verifyData.error || 'Incorrect verification code. Please check your simulated SMTP mail relay or email!';
        otpError.style.display = 'flex';

        // Flash red error animation
        otpDigits.forEach(input => {
          input.value = '';
          input.style.borderColor = 'var(--danger)';
        });
        setTimeout(() => {
          otpDigits.forEach(input => input.style.borderColor = '');
          resetOTPIntensity();
          otpDigits[0].focus();
        }, 800);
        return;
      }

      // OTP Code Verified successfully, proceed to backend registration save!
      const { fullName, username, password } = pendingRegistration;

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, username, password })
      });

      const data = await res.json();
      if (!res.ok) {
        otpError.textContent = data.error || 'Database registration failed.';
        otpError.style.display = 'flex';
      } else {
        // Complete registration workflow
        otpModal.classList.remove('active');
        smtpToast.classList.remove('active');
        
        regSuccess.innerHTML = `🛡️ Account activated! Logging you in as <span style="color:#fff;">@${username}</span>...`;
        regSuccess.style.display = 'flex';
        registerForm.reset();
        pendingRegistration = null;

        // Auto transition to standard login tab and fill fields
        setTimeout(() => {
          tabLogin.click();
          document.getElementById('login-username').value = username;
          document.getElementById('login-password').value = password;
        }, 1800);
      }
    } catch (err) {
      btnVerifyOtp.disabled = false;
      btnVerifyOtp.textContent = 'Verify Shield';
      otpError.textContent = 'Server database connection failure. Try again.';
      otpError.style.display = 'flex';
    }
  }

  // Helper alert display
  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'flex';
    element.classList.add('fadeIn');
  }

  // --- 7. PASSWORD RESET LOGIC & OTP STATE MACHINE ---
  const linkForgotPassword = document.getElementById('link-forgot-password');
  const resetModal = document.getElementById('reset-modal');
  const resetModalError = document.getElementById('reset-modal-error');
  const resetModalSuccess = document.getElementById('reset-modal-success');

  const resetStep1 = document.getElementById('reset-step-1');
  const resetStep2 = document.getElementById('reset-step-2');
  const resetStep3 = document.getElementById('reset-step-3');

  const btnCancelReset1 = document.getElementById('btn-cancel-reset-1');
  const btnCancelReset2 = document.getElementById('btn-cancel-reset-2');
  const btnCancelReset3 = document.getElementById('btn-cancel-reset-3');

  const btnSubmitReset1 = document.getElementById('btn-submit-reset-1');
  const btnVerifyResetOtp = document.getElementById('btn-verify-reset-otp');
  const btnSubmitNewPassword = document.getElementById('btn-submit-new-password');

  const resetOtpDigits = document.querySelectorAll('.reset-otp-digit');

  let pendingReset = null;

  // Show Forgot Password Modal
  linkForgotPassword.addEventListener('click', (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    
    // Reset steps and inputs
    resetStep1.classList.add('active');
    resetStep2.classList.remove('active');
    resetStep3.classList.remove('active');
    
    document.getElementById('reset-username').value = '';
    document.getElementById('reset-email').value = '';
    document.getElementById('reset-new-password').value = '';
    document.getElementById('reset-confirm-password').value = '';
    
    resetModalError.style.display = 'none';
    resetModalSuccess.style.display = 'none';
    
    resetResetOtpDigits();
    resetModal.classList.add('active');
  });

  // Cancel buttons
  const closeResetModal = () => {
    resetModal.classList.remove('active');
    smtpToast.classList.remove('active');
    pendingReset = null;
  };
  btnCancelReset1.addEventListener('click', closeResetModal);
  btnCancelReset2.addEventListener('click', closeResetModal);
  btnCancelReset3.addEventListener('click', closeResetModal);

  // Step 1: Submit Username & Email to generate OTP
  btnSubmitReset1.addEventListener('click', async () => {
    resetModalError.style.display = 'none';
    const username = document.getElementById('reset-username').value.trim();
    const email = document.getElementById('reset-email').value.trim();

    if (!username || !email) {
      showError(resetModalError, 'Both username and registered email are required.');
      return;
    }

    try {
      btnSubmitReset1.disabled = true;
      const originalText = btnSubmitReset1.textContent;
      btnSubmitReset1.textContent = 'Sending Code...';

      const res = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, type: 'reset' })
      });

      const data = await res.json();
      btnSubmitReset1.disabled = false;
      btnSubmitReset1.textContent = originalText;

      if (!res.ok) {
        showError(resetModalError, data.error || 'Failed to send verification code.');
        return;
      }

      pendingReset = {
        username,
        email
      };

      if (data.simulated) {
        // Trigger SMTP Mailer Toast
        const resetCode = data.otp;
        smtpToastText.innerHTML = `Password Reset OTP code <strong style="color:#fff; font-size:0.9rem; letter-spacing:1px;">[ ${resetCode.slice(0,3)}-${resetCode.slice(3)} ]</strong> sent to <strong>${email}</strong>!`;
      } else {
        smtpToastText.innerHTML = `📨 Verification email sent! Please check your inbox (and spam folder) for <strong>${email}</strong>.`;
      }
      smtpToast.classList.add('active');

      // Transition to Step 2
      resetStep1.classList.remove('active');
      resetStep2.classList.add('active');
      
      setTimeout(() => {
        resetOtpDigits[0].focus();
      }, 100);

    } catch (err) {
      btnSubmitReset1.disabled = false;
      btnSubmitReset1.textContent = 'Send OTP';
      showError(resetModalError, 'Failed to connect to the server. Try again.');
    }
  });

  // Step 2 Shifting State Machine
  resetOtpDigits.forEach((input, index) => {
    input.addEventListener('input', () => {
      const val = input.value;
      if (!/^[0-9]$/.test(val)) {
        input.value = '';
        return;
      }
      if (index < resetOtpDigits.length - 1) {
        resetOtpDigits[index + 1].removeAttribute('disabled');
        resetOtpDigits[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (input.value === '') {
          if (index > 0) {
            resetOtpDigits[index].setAttribute('disabled', 'true');
            resetOtpDigits[index - 1].focus();
            resetOtpDigits[index - 1].value = '';
          }
        } else {
          input.value = '';
        }
      }
    });
  });

  function resetResetOtpDigits() {
    resetOtpDigits.forEach((input, idx) => {
      input.value = '';
      if (idx > 0) input.setAttribute('disabled', 'true');
    });
  }

  // Step 2: Verify OTP code
  btnVerifyResetOtp.addEventListener('click', async () => {
    resetModalError.style.display = 'none';
    if (!pendingReset) return;

    let typedCode = '';
    resetOtpDigits.forEach(input => typedCode += input.value);

    if (typedCode.length < 6) {
      showError(resetModalError, 'Please enter all 6 verification digits.');
      return;
    }

    try {
      btnVerifyResetOtp.disabled = true;
      const originalText = btnVerifyResetOtp.textContent;
      btnVerifyResetOtp.textContent = 'Verifying...';

      const res = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingReset.email, otp: typedCode })
      });

      const data = await res.json();
      btnVerifyResetOtp.disabled = false;
      btnVerifyResetOtp.textContent = originalText;

      if (!res.ok) {
        showError(resetModalError, data.error || 'Incorrect verification code. Please check your simulated SMTP mail relay or email!');
        
        // Flash red error effect
        resetOtpDigits.forEach(input => {
          input.value = '';
          input.style.borderColor = 'var(--danger)';
        });
        setTimeout(() => {
          resetOtpDigits.forEach(input => input.style.borderColor = '');
          resetResetOtpDigits();
          resetOtpDigits[0].focus();
        }, 800);
        return;
      }

      // OTP matches! Hide SMTP toast and transition to Step 3
      smtpToast.classList.remove('active');
      resetStep2.classList.remove('active');
      resetStep3.classList.add('active');
    } catch (err) {
      btnVerifyResetOtp.disabled = false;
      btnVerifyResetOtp.textContent = 'Verify OTP';
      showError(resetModalError, 'Server connection error during verification. Try again.');
    }
  });

  // Step 3: Save new password to database
  btnSubmitNewPassword.addEventListener('click', async () => {
    resetModalError.style.display = 'none';
    if (!pendingReset) return;

    const newPassword = document.getElementById('reset-new-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;

    if (!newPassword || !confirmPassword) {
      showError(resetModalError, 'Please enter and confirm your new password.');
      return;
    }

    if (newPassword.length < 6) {
      showError(resetModalError, 'Password must be at least 6 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      showError(resetModalError, 'Passwords do not match.');
      return;
    }

    // Call backend API to change password!
    try {
      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: pendingReset.username,
          newPassword
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showError(resetModalError, data.error || 'Password reset failed.');
      } else {
        // Complete
        resetStep3.classList.remove('active');
        resetModalSuccess.innerHTML = `🛡️ Password updated successfully! Redirecting you to Sign In...`;
        resetModalSuccess.style.display = 'flex';
        
        const resetUsername = pendingReset.username;
        setTimeout(() => {
          closeResetModal();
          tabLogin.click();
          document.getElementById('login-username').value = resetUsername;
          document.getElementById('login-password').value = '';
        }, 2200);
      }
    } catch (err) {
      showError(resetModalError, 'Database connection error. Try again.');
    }
  });
});
