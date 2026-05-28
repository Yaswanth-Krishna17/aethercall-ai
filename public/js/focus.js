// AI Focus Tracker - Google MediaPipe + Telemetry Heuristics Engine
(function() {
  let focusScore = 100;
  
  // Distraction flags
  let isDistracted = false;
  let isDrowsy = false;
  let eyesClosedStartTime = null;

  // Non-Camera Telemetry States
  let lastActivityTime = Date.now();
  let tabVisible = true;
  let windowFocused = true;

  // Canvas visualizer details
  let canvasElement = null;
  let canvasCtx = null;

  // Callback to emit focus metrics to main controller
  let heartbeatCallback = null;

  // --- 1. Global Entry Point ---
  window.initializeFocusTracker = function(mediaStream, onHeartbeat) {
    heartbeatCallback = onHeartbeat;
    canvasElement = document.getElementById('local-mesh-canvas');
    if (canvasElement) {
      canvasCtx = canvasElement.getContext('2d');
    }

    // Attach non-camera fallback window telemetry hooks
    setupTelemetryHooks();

    // Trigger periodic score reporting loop (every 10 seconds)
    setInterval(dispatchFocusHeartbeat, 10000);

    // If media stream is available, initialize Google MediaPipe
    if (mediaStream && mediaStream.getVideoTracks().length > 0 && typeof FaceMesh !== 'undefined') {
      try {
        startFaceMeshAnalysis(mediaStream);
      } catch (err) {
        console.error('FaceMesh launch failed. Falling back to interaction telemetry.', err);
      }
    } else {
      console.log('No active camera stream. Using camera-less telemetry framework.');
    }
  };

  // --- 2. Fallback Non-Camera Telemetry ---
  function setupTelemetryHooks() {
    // Track window focus/blur
    window.addEventListener('focus', () => {
      windowFocused = true;
      resetActivity();
    });
    window.addEventListener('blur', () => {
      windowFocused = false;
      isDistracted = true;
    });

    // Track tab visibility
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        tabVisible = false;
        isDistracted = true;
      } else {
        tabVisible = true;
        resetActivity();
      }
    });

    // Track interactive user keyboard / mouse movements
    const activityEvents = ['mousemove', 'keypress', 'scroll', 'click'];
    activityEvents.forEach(evt => {
      window.addEventListener(evt, resetActivity, { passive: true });
    });
  }

  function resetActivity() {
    lastActivityTime = Date.now();
    if (tabVisible && windowFocused) {
      isDistracted = false;
    }
  }

  // --- 3. Google MediaPipe Face Mesh Engine ---
  function startFaceMeshAnalysis(mediaStream) {
    const videoElement = document.getElementById('local-video');
    const hiddenVideoElement = document.getElementById('hidden-video-capture');
    
    // Bind stream to hidden video processor to support camera-off background execution
    hiddenVideoElement.srcObject = mediaStream;

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true, // Crucial for high-accuracy iris tracking (points 468-477)
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results) => {
      analyzeFaceMeshResults(results);
    });

    // Read camera frames and feed into MediaPipe processor
    const camera = new Camera(hiddenVideoElement, {
      onFrame: async () => {
        // Only run frames if video stream is active
        if (mediaStream.getVideoTracks()[0].enabled) {
          await faceMesh.send({ image: hiddenVideoElement });
        }
      },
      width: 640,
      height: 360
    });
    camera.start();
  }

  // --- 4. Mathematical Feature Tracking (EAR, Gaze, Head Pitch/Yaw) ---
  function analyzeFaceMeshResults(results) {
    if (!canvasElement || !canvasCtx) return;

    // Sync canvas sizing with local video stream aspect boundaries
    canvasElement.width = canvasElement.clientWidth;
    canvasElement.height = canvasElement.clientHeight;
    
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    const landmarks = results.multiFaceLandmarks ? results.multiFaceLandmarks[0] : null;

    if (!landmarks) {
      // Face missing: immediately flag as looking away
      isDistracted = true;
      isDrowsy = false;
      return;
    }

    // Render cyber-mesh layout grid on screen (wow factor)
    drawFacialMeshVisuals(landmarks);

    // --- Feature A: Drowsiness / Blink Rate (Eye Aspect Ratio - EAR) ---
    // Left eye vertical top 386, bottom 374 | horizontal corner 362, corner 263
    const earLeft = getEyeAspectRatio(landmarks, 386, 374, 362, 263);
    // Right eye vertical top 159, bottom 145 | horizontal corner 33, corner 133
    const earRight = getEyeAspectRatio(landmarks, 159, 145, 33, 133);
    const avgEAR = (earLeft + earRight) / 2;

    if (avgEAR < 0.15) {
      // Eyes closed: start drowsiness stopwatch
      if (!eyesClosedStartTime) {
        eyesClosedStartTime = Date.now();
      } else if (Date.now() - eyesClosedStartTime > 2000) {
        // Eyes closed for more than 2 seconds
        isDrowsy = true;
      }
    } else {
      // Eyes open
      eyesClosedStartTime = null;
      isDrowsy = false;
    }

    // --- Feature B: Head Pose (Yaw & Pitch) Look Away ---
    // Track nose tip 4 relative to left boundary 234 and right boundary 454
    const nose = landmarks[4];
    const leftFace = landmarks[234];
    const rightFace = landmarks[454];

    const distLeft = Math.abs(nose.x - leftFace.x);
    const distRight = Math.abs(nose.x - rightFace.x);
    const horizontalRatio = distLeft / distRight;

    // Track vertical pitch (nose relative to chin 152 and upper nose bridge 168)
    const chin = landmarks[152];
    const noseBridge = landmarks[168];
    const distTop = Math.abs(nose.y - noseBridge.y);
    const distBottom = Math.abs(nose.y - chin.y);
    const verticalRatio = distTop / distBottom;

    // Detect looks away
    const turnedLeftRight = horizontalRatio < 0.45 || horizontalRatio > 2.2;
    const turnedUpDown = verticalRatio < 0.35 || verticalRatio > 1.8;

    // --- Feature C: Eye Gaze Shift (Iris Tracking) ---
    // Left iris center 468 | right iris center 473
    const leftIris = landmarks[468];
    const rightIris = landmarks[473];

    // Measure iris distance offset relative to eye corner boundaries
    const irisLeftOffset = Math.abs(leftIris.x - landmarks[362].x) / Math.abs(landmarks[263].x - landmarks[362].x);
    const irisRightOffset = Math.abs(rightIris.x - landmarks[33].x) / Math.abs(landmarks[133].x - landmarks[33].x);

    const gazeShifted = irisLeftOffset < 0.28 || irisLeftOffset > 0.72 || irisRightOffset < 0.28 || irisRightOffset > 0.72;

    // Aggregate visual diagnostic flags
    if (turnedLeftRight || turnedUpDown || gazeShifted) {
      isDistracted = true;
    } else {
      isDistracted = false;
    }
  }

  // --- 5. EAR Geometry calculation helper ---
  function getEyeAspectRatio(landmarks, top, bottom, left, right) {
    const pTop = landmarks[top];
    const pBottom = landmarks[bottom];
    const pLeft = landmarks[left];
    const pRight = landmarks[right];

    const vertDist = Math.sqrt(Math.pow(pTop.x - pBottom.x, 2) + Math.pow(pTop.y - pBottom.y, 2));
    const horizDist = Math.sqrt(Math.pow(pLeft.x - pRight.x, 2) + Math.pow(pLeft.y - pRight.y, 2));

    return vertDist / horizDist;
  }

  // --- 6. Futuristic Cyber-Mesh Renderer ---
  function drawFacialMeshVisuals(landmarks) {
    if (!canvasCtx || !canvasElement) return;

    canvasCtx.strokeStyle = 'rgba(16, 185, 129, 0.4)'; // Emerald glowing lines
    canvasCtx.lineWidth = 1;

    // Draw eye boundaries
    drawPolyline(landmarks, [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380]);
    
    // Draw outer lip loop
    drawPolyline(landmarks, [61, 37, 0, 267, 291, 321, 314, 17, 84, 91]);

    // Draw outer face outline
    drawPolyline(landmarks, [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]);

    // Draw glowing iris tracking target nodes
    canvasCtx.fillStyle = 'rgba(6, 182, 212, 0.9)'; // Cyan nodes
    drawDot(landmarks[468]); // Left Iris Center
    drawDot(landmarks[473]); // Right Iris Center
  }

  function drawPolyline(landmarks, points) {
    canvasCtx.beginPath();
    points.forEach((idx, i) => {
      const pt = landmarks[idx];
      const x = pt.x * canvasElement.width;
      const y = pt.y * canvasElement.height;
      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
    });
    canvasCtx.closePath();
    canvasCtx.stroke();
  }

  function drawDot(pt) {
    if (!pt) return;
    const x = pt.x * canvasElement.width;
    const y = pt.y * canvasElement.height;
    canvasCtx.beginPath();
    canvasCtx.arc(x, y, 3, 0, 2 * Math.PI);
    canvasCtx.fill();
  }

  // --- 7. Periodic Telemetry Heartbeat Score calculations ---
  function dispatchFocusHeartbeat() {
    // If not focused on window or tab, drain immediately to 0
    if (!windowFocused || !tabVisible) {
      focusScore = 0;
    } else {
      const inactiveDuration = Date.now() - lastActivityTime;
      
      if (isDrowsy) {
        // Drowsy drops score rapidly
        focusScore = Math.max(0, focusScore - 40);
      } else if (isDistracted) {
        // Distracted look away
        focusScore = Math.max(0, focusScore - 25);
      } else if (inactiveDuration > 180000) {
        // Complete mouse dormancy over 3 minutes decays score
        focusScore = Math.max(10, focusScore - 15);
      } else {
        // Focused recovers score
        focusScore = Math.min(100, focusScore + 15);
      }
    }

    // Trigger listener callback to emit stats
    if (heartbeatCallback) {
      heartbeatCallback(focusScore, {
        drowsy: isDrowsy,
        distracted: isDistracted
      });
    }
  }

})();
