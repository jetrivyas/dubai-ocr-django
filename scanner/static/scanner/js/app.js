// ============================================================
// Config — tweak these to tune speed vs accuracy
// ============================================================
const ANALYSIS_INTERVAL_MS = 250;  // was 350 — faster feedback
const CAPTURE_AFTER        = 3;    // was 5 — auto-capture sooner
const JPEG_QUALITY         = 0.95; // high quality — OCR on MRZ needs this
const MAX_CAPTURE_DIM      = 3000; // only cap truly extreme resolutions; OCR needs detail

// ============================================================
// State
// ============================================================
let currentDocType  = "passport";
let scanStep        = "front";
let capturedImages  = { front: null, back: null };
let mediaStream     = null;
let analysisLoopId  = null;
let analysisRunning = false;   // guard — skip frame if previous one is still processing
let lastApiResponse = null;

let prevFrameData = null;
let stableCount   = 0;
let allPassCount  = 0;

// ============================================================
// DOM refs
// ============================================================
const views = {
    docType:    document.getElementById("view-doc-type"),
    method:     document.getElementById("view-method"),
    ready:      document.getElementById("view-ready"),
    scanner:    document.getElementById("view-scanner"),
    upload:     document.getElementById("view-upload"),
    processing: document.getElementById("view-processing"),
    results:    document.getElementById("view-results"),
};

const lblDocType         = document.getElementById("lbl-doc-type");
const readyTitle         = document.getElementById("ready-title");
const cameraFeed         = document.getElementById("camera-feed");
const cameraOverlay      = document.getElementById("camera-overlay");
const scannerInstruction = document.getElementById("scanner-instruction");
const captureCanvas      = document.getElementById("capture-canvas");
const scanLine           = document.getElementById("scan-line");

const liveFeedback       = document.getElementById("live-feedback");
const statLight          = document.getElementById("stat-light");
const statBlur           = document.getElementById("stat-blur");
const statStable         = document.getElementById("stat-stable");
const statScale          = document.getElementById("stat-scale");
const statQuality        = document.getElementById("stat-quality");
const scanProgress       = document.getElementById("scan-progress");
const scanProgressLabel  = document.getElementById("scan-progress-label");

const uploadFrontContainer = document.getElementById("upload-front-container");
const uploadBackContainer  = document.getElementById("upload-back-container");
const fileFront            = document.getElementById("file-front");
const fileBack             = document.getElementById("file-back");

// ============================================================
// Navigation
// ============================================================
function showView(name) {
    Object.values(views).forEach(v => {
        v.classList.add("hidden");
        v.classList.remove("flex");
    });
    views[name].classList.remove("hidden");
    views[name].classList.add("flex");
}

const viewIdMap = { "view-doc-type": "docType", "view-method": "method" };
function goBack(targetId) {
    stopScanning();
    showView(viewIdMap[targetId] || "docType");
}

function resetFlow() {
    stopScanning();
    capturedImages = { front: null, back: null };
    scanStep = "front";
    fileFront.value = "";
    fileBack.value  = "";
    showView("docType");
}

// ============================================================
// 1. Select Document Type
// ============================================================
function selectDocType(type) {
    currentDocType = type;
    lblDocType.textContent = type === "passport" ? "Passport" : "ID Card";
    showView("method");
}

// ============================================================
// 2. Ready screen
// ============================================================
function showReadyScreen() {
    scanStep = "front";
    capturedImages = { front: null, back: null };
    readyTitle.textContent = currentDocType === "passport"
        ? "Ready to scan your Passport?"
        : "Ready to scan the FRONT of your ID?";
    showView("ready");
}

function showReadyScreenBack() {
    scanStep = "back";
    readyTitle.textContent = "Ready to scan the BACK of your ID?";
    showView("ready");
}

// ============================================================
// 3. Live Scanner
// ============================================================
function startScanning() {
    showView("scanner");
    prevFrameData = null;
    stableCount   = 0;
    allPassCount  = 0;

    cameraOverlay.className =
        "absolute border-2 border-dashed rounded-lg transition-all duration-300 " +
        "shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]";

    if (currentDocType === "passport") {
        cameraOverlay.classList.add("overlay-passport", "border-blue-400");
        scannerInstruction.textContent = "Align Passport inside the box";
    } else {
        cameraOverlay.classList.add("overlay-id", "border-emerald-400");
        scannerInstruction.textContent = scanStep === "front"
            ? "Align FRONT of ID inside the box"
            : "Align BACK of ID inside the box";
    }

    updateProgress(0);
    scanLine.style.opacity = "1";
    scanLine.classList.remove("bg-emerald-400");
    scanLine.classList.add("bg-red-500");

    openCamera();
}

function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        alert("Camera API not supported.");
        goBack("view-method");
        return;
    }
    navigator.mediaDevices
        .getUserMedia({
            video: {
                facingMode: "environment",
                width:  { ideal: 1920 },   // was 4096 — no need for 4K, OCR doesn't benefit
                height: { ideal: 1080 },
                advanced: [{ focusMode: "continuous" }],
            },
        })
        .then(stream => {
            mediaStream = stream;
            cameraFeed.srcObject = stream;
            cameraFeed.onloadedmetadata = () => startAnalysisLoop();
        })
        .catch(() => {
            alert("Camera access denied.");
            goBack("view-method");
        });
}

function stopScanning() {
    stopAnalysisLoop();
    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }
    cameraFeed.srcObject = null;
    scanLine.style.opacity = "0";
}

// ============================================================
// 4. Analysis loop — with guard against pile-up
// ============================================================
function startAnalysisLoop() {
    stopAnalysisLoop();
    analysisLoopId = setInterval(() => {
        if (analysisRunning) return;   // skip frame — previous still computing
        analysisRunning = true;
        try {
            analyseFrame();
        } finally {
            analysisRunning = false;
        }
    }, ANALYSIS_INTERVAL_MS);
}

function stopAnalysisLoop() {
    if (analysisLoopId) {
        clearInterval(analysisLoopId);
        analysisLoopId = null;
    }
    analysisRunning = false;
}

function getCropRect() {
    const vRect = cameraFeed.getBoundingClientRect();
    const oRect = cameraOverlay.getBoundingClientRect();

    const videoRatio     = cameraFeed.videoWidth / cameraFeed.videoHeight;
    const containerRatio = vRect.width / vRect.height;

    let renderWidth, renderHeight, offsetX, offsetY;
    if (videoRatio > containerRatio) {
        renderHeight = vRect.height;
        renderWidth  = renderHeight * videoRatio;
        offsetX = (renderWidth - vRect.width) / 2;
        offsetY = 0;
    } else {
        renderWidth  = vRect.width;
        renderHeight = renderWidth / videoRatio;
        offsetX = 0;
        offsetY = (renderHeight - vRect.height) / 2;
    }

    const scale = cameraFeed.videoWidth / renderWidth;
    return {
        sx: Math.max(0, Math.floor(((oRect.left - vRect.left) + offsetX) * scale)),
        sy: Math.max(0, Math.floor(((oRect.top  - vRect.top)  + offsetY) * scale)),
        sw: Math.floor(oRect.width  * scale),
        sh: Math.floor(oRect.height * scale),
    };
}

function analyseFrame() {
    if (!mediaStream || cameraFeed.videoWidth === 0) return;

    const vw = cameraFeed.videoWidth;
    const vh = cameraFeed.videoHeight;
    captureCanvas.width  = vw;
    captureCanvas.height = vh;
    const ctx = captureCanvas.getContext("2d");
    ctx.drawImage(cameraFeed, 0, 0, vw, vh);

    const { sx, sy, sw, sh } = getCropRect();
    const imgData  = ctx.getImageData(sx, sy, sw, sh);
    const d        = imgData.data;
    const totalPx  = sw * sh;

    // ---- BRIGHTNESS ----
    let brightnessSum = 0;
    for (let i = 0; i < d.length; i += 16) {
        brightnessSum += (d[i] + d[i+1] + d[i+2]) / 3;
    }
    const avgBright = brightnessSum / (totalPx / 4);

    let lightOk = false, lightLabel, lightHint = "";
    if      (avgBright < 35)  { lightLabel = "Dark";   lightHint = "💡 Need more light"; }
    else if (avgBright < 55)  { lightLabel = "Dim";    lightHint = "💡 A bit more light needed"; }
    else if (avgBright > 240) { lightLabel = "Glare";  lightHint = "🔆 Too bright — reduce glare"; }
    else                      { lightLabel = "Good";   lightOk = true; }

    // ---- BLUR (Laplacian variance) ----
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

    let blurOk = false, blurLabel, blurHint = "";
    if      (blurScore < 2) { blurLabel = "Blurry"; blurHint = "📷 Very blurry — hold steady"; }
    else if (blurScore < 4) { blurLabel = "Soft";   blurHint = "📷 Slightly blurry — hold steady"; }
    else                    { blurLabel = "Sharp";  blurOk = true; }

    // ---- STABILITY ----
    const sampleSize = 64;
    const curSample  = new Uint8Array(sampleSize * sampleSize);
    const stepX = Math.floor(sw / sampleSize);
    const stepY = Math.floor(sh / sampleSize);
    for (let gy = 0; gy < sampleSize; gy++) {
        for (let gx = 0; gx < sampleSize; gx++) {
            const idx = ((gy * stepY) * sw + (gx * stepX)) * 4;
            curSample[gy * sampleSize + gx] = d[idx];
        }
    }

    let stableOk = false, stableLabel, stableHint = "";
    if (prevFrameData) {
        let diffSum = 0;
        for (let i = 0; i < curSample.length; i++) diffSum += Math.abs(curSample[i] - prevFrameData[i]);
        const avgDiff = diffSum / curSample.length;

        if      (avgDiff < 8)  { stableLabel = "Stable";  stableOk = true; stableCount++; }
        else if (avgDiff < 15) { stableLabel = "Moving";  stableHint = "🤚 Hold still"; stableCount = Math.max(0, stableCount - 1); }
        else                   { stableLabel = "Shaky";   stableHint = "🤚 Too much movement"; stableCount = 0; }
    } else {
        stableLabel = "Wait...";
        stableCount++;
    }
    prevFrameData = curSample;

    // ---- SCALE (edge density) ----
    let edgeCount = 0;
    for (let y = 2; y < sh - 2; y += 4) {
        for (let x = 2; x < sw - 2; x += 4) {
            const idx = (y * sw + x) * 4;
            if (Math.abs(d[idx] - d[idx + 8]) > 20 || Math.abs(d[idx] - d[idx + rs * 2]) > 20) {
                edgeCount++;
            }
        }
    }
    const edgeRatio = edgeCount / ((sw / 4) * (sh / 4));

    let scaleOk = false, scaleLabel, scaleHint = "";
    if      (edgeRatio < 0.03) { scaleLabel = "Far";   scaleHint = "🔍 Move closer"; }
    else if (edgeRatio < 0.06) { scaleLabel = "Close"; scaleHint = "🔍 A little closer"; }
    else if (edgeRatio > 0.70) { scaleLabel = "Close"; scaleHint = "🔍 Move back slightly"; }
    else                       { scaleLabel = "Good";  scaleOk = true; }

    // ---- OVERALL QUALITY ----
    const passed    = [lightOk, blurOk, stableOk, scaleOk].filter(Boolean).length;
    const qualityOk = passed >= 3 && stableCount >= 1;
    const qualityLabel = qualityOk ? "Ready" : (passed >= 3 ? "Almost" : passed >= 2 ? "Fair" : "Poor");

    // ---- Update UI ----
    setStatUI(statLight,   lightLabel,   lightOk);
    setStatUI(statBlur,    blurLabel,    blurOk);
    setStatUI(statStable,  stableLabel,  stableOk);
    setStatUI(statScale,   scaleLabel,   scaleOk);
    setStatUI(statQuality, qualityLabel, qualityOk);

    const passedChecks = [lightOk, blurOk, stableOk, scaleOk, qualityOk].filter(Boolean).length;
    updateProgress(passedChecks / 5 * 100);
    scanProgressLabel.textContent = `${passedChecks} / 5 checks passed`;

    const hint = lightHint || blurHint || stableHint || scaleHint;
    if (qualityOk) {
        liveFeedback.textContent = "✅ Perfect — capturing...";
        liveFeedback.className = "text-center text-sm font-bold text-emerald-400 min-h-[24px] transition-all";
    } else if (hint) {
        liveFeedback.textContent = hint;
        liveFeedback.className = "text-center text-sm font-medium text-yellow-300 min-h-[24px] transition-all";
    } else {
        liveFeedback.textContent = "Analyzing document...";
        liveFeedback.className = "text-center text-sm font-medium text-gray-400 min-h-[24px] transition-all";
    }

    if (qualityOk) {
        scanLine.classList.replace("bg-red-500",    "bg-emerald-400");
        scanLine.classList.replace("bg-yellow-400", "bg-emerald-400");
        cameraOverlay.classList.remove("border-blue-400", "border-yellow-400", "border-red-400");
        cameraOverlay.classList.add("border-emerald-400");
    } else if (passedChecks >= 3) {
        scanLine.classList.replace("bg-red-500",    "bg-yellow-400");
        scanLine.classList.replace("bg-emerald-400","bg-yellow-400");
        cameraOverlay.classList.remove("border-emerald-400", "border-red-400");
        cameraOverlay.classList.add("border-yellow-400");
    } else {
        scanLine.classList.replace("bg-emerald-400","bg-red-500");
        scanLine.classList.replace("bg-yellow-400", "bg-red-500");
    }

    // ---- AUTO CAPTURE ----
    if (qualityOk) {
        allPassCount++;
        if (allPassCount >= CAPTURE_AFTER) autoCapture();
    } else {
        allPassCount = 0;
    }
}

function setStatUI(el, label, ok) {
    el.textContent = label;
    el.className   = ok ? "font-bold text-emerald-400" : "font-bold text-yellow-400";
}

function updateProgress(pct) {
    scanProgress.style.width = pct + "%";
    scanProgress.className = "h-full rounded-full transition-all duration-500 " + (
        pct >= 100 ? "bg-emerald-400" : pct >= 60 ? "bg-yellow-400" : "bg-red-500"
    );
}

// ============================================================
// 5. Auto-capture — with downscaling before upload
// ============================================================
function autoCapture() {
    stopAnalysisLoop();

    const { sx, sy, sw, sh } = getCropRect();

    // Only downscale if truly extreme (>3000px) — OCR needs high resolution
    let outW = sw, outH = sh;
    const maxDim = Math.max(sw, sh);
    if (maxDim > MAX_CAPTURE_DIM) {
        const ratio = MAX_CAPTURE_DIM / maxDim;
        outW = Math.round(sw * ratio);
        outH = Math.round(sh * ratio);
    }

    captureCanvas.width  = outW;
    captureCanvas.height = outH;
    const ctx = captureCanvas.getContext("2d");
    ctx.drawImage(cameraFeed, sx, sy, sw, sh, 0, 0, outW, outH);

    captureCanvas.toBlob(blob => {
        if (scanStep === "front") {
            capturedImages.front = blob;
            stopScanning();
            if (currentDocType === "id") {
                showReadyScreenBack();
            } else {
                processImages();
            }
        } else {
            capturedImages.back = blob;
            stopScanning();
            processImages();
        }
    }, "image/jpeg", JPEG_QUALITY);
}

// ============================================================
// 6. Upload flow
// ============================================================
function startUpload() {
    showView("upload");
    uploadBackContainer.classList.toggle("hidden", currentDocType !== "id");
}

function submitUpload() {
    if (!fileFront.files[0]) { alert("Please upload the front image."); return; }
    capturedImages.front = fileFront.files[0];
    if (currentDocType === "id") {
        if (!fileBack.files[0]) { alert("Please upload the back image."); return; }
        capturedImages.back = fileBack.files[0];
    }
    processImages();
}

// ============================================================
// 7. Process & send to proxy — with AbortController timeout
// ============================================================
function processImages() {
    showView("processing");

    const formData = new FormData();
    formData.append("front_file", capturedImages.front, "front.jpg");

    let url = "/api/extract_passport/";
    if (currentDocType === "id") {
        url = "/api/extract_id/";
        formData.append("back_file", capturedImages.back, "back.jpg");
        formData.append("doc_type", "auto");
    }

    // Clear refs — don't hold onto large Blobs
    capturedImages = { front: null, back: null };
    fileFront.value = "";
    fileBack.value  = "";

    // Client-side timeout — give up after 20s
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 20000);

    fetch(url, { method: "POST", body: formData, signal: controller.signal })
        .then(r => {
            clearTimeout(timeoutId);
            if (!r.ok) throw new Error(`Server error ${r.status}`);
            return r.json();
        })
        .then(data => handleApiResponse(data))
        .catch(err => {
            clearTimeout(timeoutId);
            if (err.name === "AbortError") {
                showResultsError("Request timed out — the OCR service is slow. Try again.");
            } else {
                showResultsError("Network error: " + err.message);
            }
        });
}

// ============================================================
// 8. Response handling
// ============================================================
function handleApiResponse(data) {
    lastApiResponse = data;

    if (data.error) { showResultsError(data.error); return; }

    const docTypeFromApi = (data?.doc_type || "").toLowerCase().trim();

    if (currentDocType === "passport" && docTypeFromApi && docTypeFromApi !== "passport") {
        showResultsError(`Document Mismatch: Expected Passport but detected "${docTypeFromApi}".`);
        return;
    }
    if (currentDocType === "id" && docTypeFromApi === "passport") {
        showResultsError("Document Mismatch: Expected ID Card but detected a Passport.");
        return;
    }

    const ocr = data?.data?.ocrData || {};
    const m1  = Boolean(ocr.mrz1 && ocr.mrz1.trim().length > 5);
    const m2  = Boolean(ocr.mrz2 && ocr.mrz2.trim().length > 5);
    const m3  = Boolean(ocr.mrz3 && ocr.mrz3.trim().length > 5);

    if (currentDocType === "passport" && !(m1 && m2 && !m3)) {
        showResultsError("Invalid Scan: Passport requires exactly 2 MRZ lines. Try again with better lighting.");
        return;
    }
    if (currentDocType === "id" && !(m1 && m2 && m3)) {
        showResultsError("Invalid Scan: ID Card requires exactly 3 MRZ lines. Try again with better lighting.");
        return;
    }

    if (isExtractedValid(data)) {
        showResultsSuccess(data);
    } else {
        showResultsError("Extraction failed — missing critical fields. Try again in better light.");
    }
}

function isExtractedValid(data) {
    if (!data?.data?.ocrData) return false;
    const ocr = data.data.ocrData;

    if ((ocr.notExtracted || 0) >= 7) return false;

    let total = 0, filled = 0;
    const SKIP = new Set(["bbox","confidence","yolo_data","notextracted","notextracteddetails",
        "ocrdataconfidence","documentsubmissionmethod","issuefront",
        "checkedaddressbean","documentfrontsubtype","externalid"]);

    function walk(obj) {
        if (typeof obj !== "object" || obj === null) return;
        for (const k in obj) {
            if (SKIP.has(k.toLowerCase())) continue;
            const v = obj[k];
            if (typeof v === "object" && !Array.isArray(v)) { walk(v); }
            else if (typeof v === "string" || typeof v === "number") {
                total++;
                if (v !== null && v !== "" && String(v).trim() !== "" && v !== 0) filled++;
            }
        }
    }
    walk(ocr);
    return total > 0 && filled / total >= 0.30;
}

// ============================================================
// 9. Copy JSON
// ============================================================
function copyJson() {
    if (!lastApiResponse) { alert("No data to copy."); return; }
    navigator.clipboard
        .writeText(JSON.stringify(lastApiResponse, null, 2))
        .then(() => alert("JSON copied!"))
        .catch(() => alert("Copy failed — check browser permissions."));
}

// ============================================================
// 10. Result views
// ============================================================
function showResultsSuccess(data) {
    showView("results");
    document.getElementById("result-title").textContent = "Data Extracted Successfully!";
    document.getElementById("result-title").className   = "text-3xl font-bold text-emerald-400";
    document.getElementById("result-message").classList.add("hidden");
    document.getElementById("copy-container").classList.remove("hidden");
    const rc = document.getElementById("result-content");
    rc.classList.remove("hidden");
    rc.innerHTML = "";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(data, null, 2);
    rc.appendChild(pre);
}

function showResultsError(msg) {
    showView("results");
    document.getElementById("result-title").textContent = "Scan Failed";
    document.getElementById("result-title").className   = "text-3xl font-bold text-red-400";
    const rm = document.getElementById("result-message");
    rm.classList.remove("hidden");
    rm.textContent = msg + " Please try again.";
    document.getElementById("copy-container").classList.add("hidden");
    document.getElementById("result-content").classList.add("hidden");
}
