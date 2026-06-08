// ============================================================
// State
// ============================================================
let currentDocType = 'passport';
let scanStep       = 'front';
let capturedImages = { front: null, back: null };
let mediaStream    = null;
let analysisLoop   = null;
let lastApiResponse = null;

// Stability tracking — compare consecutive frames
let prevFrameData  = null;
let stableCount    = 0;        // how many consecutive frames were stable
let allPassCount   = 0;        // how many consecutive frames had ALL checks green
const CAPTURE_AFTER = 5;       // auto-capture after this many consecutive all-green frames

// ============================================================
// DOM refs
// ============================================================
const views = {
    docType:    document.getElementById('view-doc-type'),
    method:     document.getElementById('view-method'),
    ready:      document.getElementById('view-ready'),
    scanner:    document.getElementById('view-scanner'),
    upload:     document.getElementById('view-upload'),
    processing: document.getElementById('view-processing'),
    results:    document.getElementById('view-results'),
};

const lblDocType         = document.getElementById('lbl-doc-type');
const readyTitle         = document.getElementById('ready-title');
const cameraFeed         = document.getElementById('camera-feed');
const cameraOverlay      = document.getElementById('camera-overlay');
const scannerInstruction = document.getElementById('scanner-instruction');
const captureCanvas      = document.getElementById('capture-canvas');
const scanLine           = document.getElementById('scan-line');

const liveFeedback       = document.getElementById('live-feedback');
const statLight          = document.getElementById('stat-light');
const statBlur           = document.getElementById('stat-blur');
const statStable         = document.getElementById('stat-stable');
const statScale          = document.getElementById('stat-scale');
const statQuality        = document.getElementById('stat-quality');
const scanProgress       = document.getElementById('scan-progress');
const scanProgressLabel  = document.getElementById('scan-progress-label');

const uploadFrontContainer = document.getElementById('upload-front-container');
const uploadBackContainer  = document.getElementById('upload-back-container');
const fileFront            = document.getElementById('file-front');
const fileBack             = document.getElementById('file-back');

// ============================================================
// Navigation
// ============================================================
function showView(name) {
    Object.values(views).forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('flex');
    });
    views[name].classList.remove('hidden');
    views[name].classList.add('flex');
}

const viewIdMap = { 'view-doc-type': 'docType', 'view-method': 'method' };
function goBack(targetId) {
    stopScanning();
    showView(viewIdMap[targetId] || 'docType');
}

function resetFlow() {
    stopScanning();
    capturedImages = { front: null, back: null };
    scanStep = 'front';
    fileFront.value = '';
    fileBack.value = '';
    showView('docType');
}

// ============================================================
// 1. Select Document Type
// ============================================================
function selectDocType(type) {
    currentDocType = type;
    lblDocType.textContent = type === 'passport' ? 'Passport' : 'ID Card';
    showView('method');
}

// ============================================================
// 2. "Ready to Scan?" prompt
// ============================================================
function showReadyScreen() {
    scanStep = 'front';
    capturedImages = { front: null, back: null };

    if (currentDocType === 'passport') {
        readyTitle.textContent = 'Ready to scan your Passport?';
    } else {
        readyTitle.textContent = 'Ready to scan the FRONT of your ID?';
    }
    showView('ready');
}

function showReadyScreenBack() {
    scanStep = 'back';
    readyTitle.textContent = 'Ready to scan the BACK of your ID?';
    showView('ready');
}

// ============================================================
// 3. Live Scanner
// ============================================================
function startScanning() {
    showView('scanner');
    prevFrameData = null;
    stableCount   = 0;
    allPassCount  = 0;

    // Overlay + instruction
    cameraOverlay.className =
        'absolute border-2 border-dashed rounded-lg transition-all duration-300 ' +
        'shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]';

    if (currentDocType === 'passport') {
        cameraOverlay.classList.add('overlay-passport', 'border-blue-400');
        scannerInstruction.textContent = 'Align Passport inside the box';
    } else {
        cameraOverlay.classList.add('overlay-id', 'border-emerald-400');
        scannerInstruction.textContent =
            scanStep === 'front'
                ? 'Align FRONT of ID inside the box'
                : 'Align BACK of ID inside the box';
    }

    // Reset progress bar
    updateProgress(0);
    scanLine.style.opacity = '1';
    scanLine.classList.remove('bg-emerald-400');
    scanLine.classList.add('bg-red-500');

    openCamera();
}

function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        alert('Camera API not supported.');
        goBack('view-method');
        return;
    }
    navigator.mediaDevices
        .getUserMedia({
            video: { 
                facingMode: 'environment', 
                width: { ideal: 4096 }, 
                height: { ideal: 4096 },
                advanced: [{ focusMode: "continuous" }] 
            }
        })
        .then(stream => {
            mediaStream = stream;
            cameraFeed.srcObject = stream;
            cameraFeed.onloadedmetadata = () => {
                startAnalysisLoop();
            };
        })
        .catch(() => {
            alert('Camera access denied.');
            goBack('view-method');
        });
}

function stopScanning() {
    stopAnalysisLoop();
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    cameraFeed.srcObject = null;
    scanLine.style.opacity = '0';
}

// ============================================================
// 4. Real-time analysis loop (every 350 ms)
// ============================================================
function startAnalysisLoop() {
    stopAnalysisLoop();
    analysisLoop = setInterval(analyseFrame, 350);
}

function stopAnalysisLoop() {
    if (analysisLoop) { clearInterval(analysisLoop); analysisLoop = null; }
}

function getCropRect() {
    const video = cameraFeed;
    const vRect = video.getBoundingClientRect();
    const oRect = cameraOverlay.getBoundingClientRect();

    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = vRect.width / vRect.height;

    let renderWidth, renderHeight, offsetX, offsetY;

    if (videoRatio > containerRatio) {
        renderHeight = vRect.height;
        renderWidth = renderHeight * videoRatio;
        offsetX = (renderWidth - vRect.width) / 2;
        offsetY = 0;
    } else {
        renderWidth = vRect.width;
        renderHeight = renderWidth / videoRatio;
        offsetX = 0;
        offsetY = (renderHeight - vRect.height) / 2;
    }

    const scale = video.videoWidth / renderWidth;
    return {
        sx: Math.max(0, Math.floor(((oRect.left - vRect.left) + offsetX) * scale)),
        sy: Math.max(0, Math.floor(((oRect.top - vRect.top) + offsetY) * scale)),
        sw: Math.floor(oRect.width * scale),
        sh: Math.floor(oRect.height * scale)
    };
}

function analyseFrame() {
    if (!mediaStream || cameraFeed.videoWidth === 0) return;

    const vw = cameraFeed.videoWidth;
    const vh = cameraFeed.videoHeight;
    captureCanvas.width  = vw;
    captureCanvas.height = vh;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(cameraFeed, 0, 0, vw, vh);

    // Sample centre region exactly matching the visual overlay box
    const { sx, sy, sw, sh } = getCropRect();
    const imgData = ctx.getImageData(sx, sy, sw, sh);
    const d = imgData.data;
    const totalPx = sw * sh;

    // ---- 1. BRIGHTNESS ----
    let brightnessSum = 0;
    for (let i = 0; i < d.length; i += 16) {
        brightnessSum += (d[i] + d[i+1] + d[i+2]) / 3;
    }
    const avgBright = brightnessSum / (totalPx / 4);

    let lightOk = false, lightLabel, lightHint = '';
    if (avgBright < 35)       { lightLabel = 'Dark';    lightHint = '💡 Need more light'; }
    else if (avgBright < 55)  { lightLabel = 'Dim';     lightHint = '💡 A bit more light needed'; }
    else if (avgBright > 240) { lightLabel = 'Bright';  lightHint = '🔆 Too much light — reduce glare'; }
    else                      { lightLabel = 'Good';    lightOk = true; }

    // ---- 2. BLUR (Laplacian variance) ----
    let lapSum = 0, lapN = 0;
    const rs = sw * 4;
    for (let y = 1; y < sh - 1; y += 3) {
        for (let x = 1; x < sw - 1; x += 3) {
            const idx = (y * sw + x) * 4;
            const c = d[idx], t = d[idx - rs], b = d[idx + rs], l = d[idx - 4], r = d[idx + 4];
            lapSum += Math.abs(4 * c - t - b - l - r);
            lapN++;
        }
    }
    const blurScore = lapN > 0 ? lapSum / lapN : 0;

    let blurOk = false, blurLabel, blurHint = '';
    if (blurScore < 2)        { blurLabel = 'Blurry';  blurHint = '📷 Very blurry — hold steady & focus'; }
    else if (blurScore < 4)   { blurLabel = 'Soft';    blurHint = '📷 Slightly blurry — hold steady'; }
    else                      { blurLabel = 'Sharp';   blurOk = true; }

    // ---- 3. STABILITY (frame-to-frame diff) ----
    const sampleSize = 64;
    const curSample = new Uint8Array(sampleSize * sampleSize);
    const stepX = Math.floor(sw / sampleSize);
    const stepY = Math.floor(sh / sampleSize);
    for (let gy = 0; gy < sampleSize; gy++) {
        for (let gx = 0; gx < sampleSize; gx++) {
            const idx = ((gy * stepY) * sw + (gx * stepX)) * 4;
            curSample[gy * sampleSize + gx] = d[idx];
        }
    }

    let stableOk = false, stableLabel, stableHint = '';
    if (prevFrameData) {
        let diffSum = 0;
        for (let i = 0; i < curSample.length; i++) {
            diffSum += Math.abs(curSample[i] - prevFrameData[i]);
        }
        const avgDiff = diffSum / curSample.length;

        if (avgDiff < 8)       { stableLabel = 'Stable';   stableOk = true; stableCount++; }
        else if (avgDiff < 15) { stableLabel = 'Moving';   stableHint = '🤚 Hold still'; stableCount = Math.max(0, stableCount - 1); }
        else                   { stableLabel = 'Shaky';    stableHint = '🤚 Too much movement'; stableCount = 0; }
    } else {
        stableLabel = 'Wait...';
        stableCount++;
    }
    prevFrameData = curSample;

    // ---- 4. SCALE (edge density) ----
    let edgeCount = 0;
    for (let y = 2; y < sh - 2; y += 4) {
        for (let x = 2; x < sw - 2; x += 4) {
            const idx = (y * sw + x) * 4;
            const h1 = Math.abs(d[idx] - d[idx + 8]);
            const v1 = Math.abs(d[idx] - d[idx + rs * 2]);
            if (h1 > 20 || v1 > 20) edgeCount++;
        }
    }
    const edgeRatio = edgeCount / ((sw / 4) * (sh / 4));

    let scaleOk = false, scaleLabel, scaleHint = '';
    if (edgeRatio < 0.03)      { scaleLabel = 'Far';    scaleHint = '🔍 Come closer to the document'; }
    else if (edgeRatio < 0.06) { scaleLabel = 'Close';  scaleHint = '🔍 A little closer'; }
    else if (edgeRatio > 0.70) { scaleLabel = 'Close';  scaleHint = '🔍 Move back a little'; }
    else                       { scaleLabel = 'Good';   scaleOk = true; }

    // ---- 5. OVERALL QUALITY ----
    const passed = [lightOk, blurOk, stableOk, scaleOk].filter(Boolean).length;
    let qualityOk = passed >= 3 && stableCount >= 1;
    let qualityLabel = qualityOk ? 'Ready' : (passed >= 3 ? 'Almost' : (passed >= 2 ? 'Fair' : 'Poor'));

    // ---- Update UI ----
    setStatUI(statLight,   lightLabel,   lightOk);
    setStatUI(statBlur,    blurLabel,    blurOk);
    setStatUI(statStable,  stableLabel,  stableOk);
    setStatUI(statScale,   scaleLabel,   scaleOk);
    setStatUI(statQuality, qualityLabel, qualityOk);

    // Progress bar
    const totalChecks = 5;
    const passedChecks = [lightOk, blurOk, stableOk, scaleOk, qualityOk].filter(Boolean).length;
    updateProgress(passedChecks / totalChecks * 100);
    scanProgressLabel.textContent = `${passedChecks} / ${totalChecks} checks passed`;

    // Live feedback — pick the most urgent hint
    const hint = lightHint || blurHint || stableHint || scaleHint;
    if (qualityOk) {
        liveFeedback.textContent = '✅ Perfect — capturing...';
        liveFeedback.className = 'text-center text-sm font-bold text-emerald-400 min-h-[24px] transition-all';
    } else if (hint) {
        liveFeedback.textContent = hint;
        liveFeedback.className = 'text-center text-sm font-medium text-yellow-300 min-h-[24px] transition-all';
    } else {
        liveFeedback.textContent = 'Analyzing document...';
        liveFeedback.className = 'text-center text-sm font-medium text-gray-400 min-h-[24px] transition-all';
    }

    // Scan line colour
    if (qualityOk) {
        scanLine.classList.remove('bg-red-500', 'bg-yellow-400');
        scanLine.classList.add('bg-emerald-400');
    } else if (passedChecks >= 3) {
        scanLine.classList.remove('bg-red-500', 'bg-emerald-400');
        scanLine.classList.add('bg-yellow-400');
    } else {
        scanLine.classList.remove('bg-yellow-400', 'bg-emerald-400');
        scanLine.classList.add('bg-red-500');
    }

    // Overlay border colour
    if (qualityOk) {
        cameraOverlay.classList.remove('border-blue-400', 'border-emerald-400', 'border-yellow-400', 'border-red-400');
        cameraOverlay.classList.add('border-emerald-400');
    } else if (passedChecks >= 3) {
        cameraOverlay.classList.remove('border-blue-400', 'border-emerald-400', 'border-red-400');
        cameraOverlay.classList.add('border-yellow-400');
    }



    // ---- AUTO CAPTURE ----
    if (qualityOk) {
        allPassCount++;
        if (allPassCount >= CAPTURE_AFTER) {
            autoCapture();
        }
    } else {
        allPassCount = 0;
    }
}

function setStatUI(el, label, ok) {
    el.textContent = label;
    el.className = ok
        ? 'font-bold text-emerald-400'
        : 'font-bold text-yellow-400';
}

function updateProgress(pct) {
    scanProgress.style.width = pct + '%';
    if (pct >= 100) {
        scanProgress.classList.remove('bg-red-500', 'bg-yellow-400');
        scanProgress.classList.add('bg-emerald-400');
    } else if (pct >= 60) {
        scanProgress.classList.remove('bg-red-500', 'bg-emerald-400');
        scanProgress.classList.add('bg-yellow-400');
    } else {
        scanProgress.classList.remove('bg-yellow-400', 'bg-emerald-400');
        scanProgress.classList.add('bg-red-500');
    }
}



// ============================================================
// 5. Auto-capture
// ============================================================
function autoCapture() {
    stopAnalysisLoop();

    const video = cameraFeed;

    // Use the dynamic crop rectangle matching the exact visual overlay
    const { sx, sy, sw, sh } = getCropRect();

    // Set canvas to the cropped dimensions
    captureCanvas.width  = sw;
    captureCanvas.height = sh;
    
    const ctx = captureCanvas.getContext('2d');
    // Draw only the cropped portion from the video
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

    captureCanvas.toBlob(blob => {
        if (scanStep === 'front') {
            capturedImages.front = blob;
            stopScanning();

            if (currentDocType === 'id') {
                // Need back — show ready screen for back
                showReadyScreenBack();
            } else {
                // Passport done
                processImages();
            }
        } else {
            capturedImages.back = blob;
            stopScanning();
            processImages();
        }
    }, 'image/jpeg', 0.95);
}

// ============================================================
// 6. Upload flow
// ============================================================
function startUpload() {
    showView('upload');
    uploadBackContainer.classList.toggle('hidden', currentDocType !== 'id');
}

function submitUpload() {
    if (!fileFront.files[0]) { alert('Please upload the front image.'); return; }
    capturedImages.front = fileFront.files[0];

    if (currentDocType === 'id') {
        if (!fileBack.files[0]) { alert('Please upload the back image.'); return; }
        capturedImages.back = fileBack.files[0];
    }
    processImages();
}

// ============================================================
// 7. Process & API
// ============================================================
function processImages() {
    showView('processing');

    const formData = new FormData();
    formData.append('front_file', capturedImages.front, 'front.jpg');

    let url = '/api/extract_passport/';
    if (currentDocType === 'id') {
        url = '/api/extract_id/';
        formData.append('back_file', capturedImages.back, 'back.jpg');
        formData.append('doc_type', 'auto');
    }

    capturedImages = { front: null, back: null };
    fileFront.value = '';
    fileBack.value  = '';

    fetch(url, { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => handleApiResponse(data))
        .catch(err => { console.error(err); showResultsError('Network error or backend failed.'); });
}

// ============================================================
// 8. Response handling
// ============================================================
function handleApiResponse(data) {
    lastApiResponse = data;

    if (data.error) { showResultsError(data.error); return; }

    // Document type cross-check using top-level doc_type field
    const docTypeFromApi = (data?.doc_type || '').toLowerCase().trim();

    if (currentDocType === 'passport') {
        if (docTypeFromApi && docTypeFromApi !== 'passport') {
            showResultsError(`Document Mismatch: Expected Passport but API detected "${docTypeFromApi}".`);
            return;
        }
    } else if (currentDocType === 'id') {
        if (docTypeFromApi === 'passport') {
            showResultsError('Document Mismatch: Expected ID Card but API detected a Passport.');
            return;
        }
    }

    // Strict MRZ Check
    const ocr = data?.data?.ocrData || {};
    const m1 = Boolean(ocr.mrz1 && ocr.mrz1.trim().length > 5);
    const m2 = Boolean(ocr.mrz2 && ocr.mrz2.trim().length > 5);
    const m3 = Boolean(ocr.mrz3 && ocr.mrz3.trim().length > 5);

    // Debug string to show exactly what the API returned
    const debugMrz = `[API returned -> mrz1: "${ocr.mrz1 || ''}", mrz2: "${ocr.mrz2 || ''}", mrz3: "${ocr.mrz3 || ''}"]`;

    if (currentDocType === 'passport') {
        // Passport requires exactly 2 MRZ lines (mrz1, mrz2) and NO mrz3
        if (!(m1 && m2 && !m3)) {
            showResultsError(`Invalid Scan: Passport must have exactly 2 MRZ lines detected.`);
            return;
        }
    } else if (currentDocType === 'id') {
        // ID requires exactly 3 MRZ lines (mrz1, mrz2, mrz3)
        if (!(m1 && m2 && m3)) {
            showResultsError(`Invalid Scan: ID Card must have exactly 3 MRZ lines detected.`);
            return;
        }
    }

    if (isExtractedValid(data)) {
        showResultsSuccess(data);
    } else {
        showResultsError('Extraction failed — could not read clearly or missing critical fields.');
    }
}

function isExtractedValid(data) {
    if (!data || !data.data || !data.data.ocrData) return false;

    const ocr = data.data.ocrData;

    // 1. Check notExtracted — API tells us how many critical fields it failed on
    const notExtracted = ocr.notExtracted || 0;
    // Relaxed: only reject if it missed a huge number of fields (e.g. >= 7)
    if (notExtracted >= 7) {
        console.log(`Rejected: ${notExtracted} fields not extracted`);
        return false;
    }

    // 3. Basic fill check — changed to 30% to account for many optional fields the OCR leaves blank
    let total = 0, filled = 0;
    const SKIP_KEYS = ['bbox', 'confidence', 'yolo_data', 'notextracted', 'notextracteddetails',
                        'ocrdataconfidence', 'documentsubmissionmethod', 'issuefront',
                        'checkedaddressbean', 'documentfrontsubtype', 'externalid'];
    function walk(obj) {
        if (typeof obj !== 'object' || obj === null) return;
        for (const k in obj) {
            const v = obj[k];
            if (SKIP_KEYS.includes(k.toLowerCase())) continue;
            if (typeof v === 'object' && !Array.isArray(v) && v !== null) { walk(v); }
            else if (typeof v === 'string' || typeof v === 'number') {
                total++;
                if (v !== null && v !== '' && String(v).trim() !== '' && v !== 0) filled++;
            }
        }
    }
    walk(ocr);

    if (total === 0) return false;
    const ratio = filled / total;
    console.log(`Field fill: ${filled}/${total} (${(ratio * 100).toFixed(1)}%)`);
    return ratio >= 0.30;
}

// ============================================================
// 9. Copy JSON
// ============================================================
function copyJson() {
    if (!lastApiResponse) { alert('No data.'); return; }
    navigator.clipboard.writeText(JSON.stringify(lastApiResponse, null, 2))
        .then(() => alert('JSON copied!'))
        .catch(() => alert('Copy failed.'));
}

// ============================================================
// 10. Result views
// ============================================================
function showResultsSuccess(data) {
    showView('results');
    document.getElementById('result-title').textContent = 'Data Extracted Successfully!';
    document.getElementById('result-title').className   = 'text-3xl font-bold text-emerald-400';
    document.getElementById('result-message').classList.add('hidden');
    document.getElementById('copy-container').classList.remove('hidden');
    const rc = document.getElementById('result-content');
    rc.classList.remove('hidden');
    rc.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(data, null, 2);
    rc.appendChild(pre);
}

function showResultsError(msg) {
    showView('results');
    document.getElementById('result-title').textContent = 'Invalid Document';
    document.getElementById('result-title').className   = 'text-3xl font-bold text-red-400';
    const rm = document.getElementById('result-message');
    rm.classList.remove('hidden');
    rm.textContent = msg + ' Please try again.';
    document.getElementById('copy-container').classList.add('hidden');
    document.getElementById('result-content').classList.add('hidden');
}
