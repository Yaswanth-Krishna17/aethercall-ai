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

    // Generate secure 6-digit verification code
    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

    // Cache the pending registration fields in memory
    pendingRegistration = {
      fullName,
      email,
      username,
      password,
      code: generatedOTP
    };

    // Trigger SMTP Mailer Toast Notification
    smtpToastText.innerHTML = `Secure verification code <strong style="color:#fff; font-size:0.9rem; letter-spacing:1px;">[ ${generatedOTP.slice(0,3)}-${generatedOTP.slice(3)} ]</strong> sent to <strong>${email}</strong>!`;
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

    if (typedCode !== pendingRegistration.code) {
      otpError.textContent = 'Incorrect verification code. Please check your simulated SMTP mail relay!';
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

    try {
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
});
