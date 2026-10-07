// @ts-check
/* SPOT AI — Try the Model: 브라우저 안에서 ONNX Runtime Web으로 토양 이미지 추론 (서버 전송 없음) */

(function () {
  "use strict";

  const root = /** @type {HTMLElement | null} */ (document.querySelector("[data-model-test]"));
  if (!root) return;

  // ----- 설정 -----
  const ORT_VERSION = "1.30.0";
  const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VERSION + "/dist/";
  const ORT_SCRIPT = ORT_BASE + "ort.wasm.min.js";
  const ORT_SRI = "sha384-Bw6URI+Gvoadw0do7/QrSHUC9D1vCYYK5OSqChFyhyV5mzPL4oe2rOAFljAnS8Sq";
  const MODEL_URL = root.dataset.modelUrl || "models/soil_moisture.onnx";

  const CLASSES = ["Dry", "Moderate", "Wet"]; // 0 = Dry, 1 = Moderate, 2 = Wet
  const CLASS_DOT = ["pp-dot--dry", "pp-dot--mid", "pp-dot--wet"];
  // Soil ROI (정규화 좌표). 공개 데이터셋은 이미지 전체가 토양이므로 기본값은 전체 영역
  const ROI = { x0: 0.0, y0: 0.0, x1: 1.0, y1: 1.0 };
  const DEFAULT_SIZE = 160;
  const MAX_PIXELS = 50e6;
  const ACCEPT_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const ACCEPT_EXT = /\.(jpe?g|png|webp)$/i;

  // ----- DOM -----
  /** @param {string} sel */
  const $ = (sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  const drop = $("[data-drop]");
  const fileInput = /** @type {HTMLInputElement} */ ($("[data-file]"));
  const emptyView = $("[data-drop-empty]");
  const previewView = $("[data-drop-preview]");
  const previewImg = /** @type {HTMLImageElement} */ ($("[data-preview]"));
  const result = $(".pp-result");
  const views = {
    initial: $("[data-result-initial]"),
    loading: $("[data-result-loading]"),
    success: $("[data-result-success]"),
    error: $("[data-result-error]"),
  };
  const resultClass = $("[data-result-class]");
  const resultDot = $("[data-result-dot]");
  const resultConf = $("[data-result-conf]");
  const errorText = $("[data-result-error-text]");
  const modelStatus = $("[data-model-status]");
  const modelStatusText = $("[data-model-status-text]");

  /** @param {"initial" | "loading" | "success" | "error"} state */
  function setState(state) {
    result.dataset.state = state;
    Object.entries(views).forEach(function ([key, el]) { el.hidden = key !== state; });
  }

  /** @param {string} message */
  function showError(message) {
    errorText.textContent = message;
    setState("error");
  }

  /** @param {"loading" | "ready" | "error"} status @param {string} text */
  function setModelStatus(status, text) {
    modelStatus.classList.toggle("is-ready", status === "ready");
    modelStatus.classList.toggle("is-error", status === "error");
    modelStatusText.textContent = text;
  }

  // ----- ONNX Runtime + 모델: 한 번만 로드하고 Session 재사용 -----
  /** @type {Promise<any> | null} */
  let sessionPromise = null;

  function loadOrt() {
    const w = /** @type {any} */ (window);
    if (w.ort) return Promise.resolve(w.ort);
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = ORT_SCRIPT;
      s.integrity = ORT_SRI;
      s.crossOrigin = "anonymous";
      s.onload = function () { w.ort ? resolve(w.ort) : reject(new Error("ort global missing")); };
      s.onerror = function () { reject(new Error("Failed to load " + ORT_SCRIPT)); };
      document.head.appendChild(s);
    });
  }

  function getSession() {
    if (sessionPromise) return sessionPromise;
    setModelStatus("loading", "모델 불러오는 중 · soil_moisture.onnx");
    sessionPromise = loadOrt()
      .then(function (ort) {
        ort.env.wasm.wasmPaths = ORT_BASE;
        ort.env.wasm.numThreads = 1;
        return ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
      })
      .then(function (session) {
        console.info("[SPOT AI] ONNX model loaded", {
          inputs: session.inputNames,
          outputs: session.outputNames,
          inputMetadata: session.inputMetadata,
        });
        setModelStatus("ready", "모델 준비 완료 · soil_moisture.onnx · ONNX Runtime Web");
        return session;
      })
      .catch(function (err) {
        console.error("[SPOT AI] ONNX model load failed:", err);
        setModelStatus("error", "모델을 불러오지 못했습니다");
        sessionPromise = null; // 다음 시도에서 다시 로드
        throw Object.assign(new Error("model"), { userMessage: "모델을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
      });
    return sessionPromise;
  }

  // 섹션이 화면에 가까워지면 미리 로드 (페이지 진입 시 불필요한 다운로드 방지)
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        getSession().catch(function () {});
      }
    }, { rootMargin: "600px 0px" });
    io.observe(root);
  } else {
    getSession().catch(function () {});
  }

  // ----- 입력 Layout: 실제 ONNX input metadata 기준 -----
  /**
   * @param {any} session
   * @returns {{ name: string, layout: "NHWC" | "NCHW", h: number, w: number }}
   */
  function resolveInput(session) {
    const name = session.inputNames[0];
    const meta = (session.inputMetadata || []).find(function (/** @type {any} */ m) { return m.name === name; });
    const shape = meta && meta.shape;
    if (!shape || shape.length !== 4) {
      // 메타데이터를 제공하지 않는 런타임: 변환 시 확인한 [N, 160, 160, 3] 사용
      console.warn("[SPOT AI] input metadata unavailable; using verified NHWC [N,160,160,3]");
      return { name: name, layout: "NHWC", h: DEFAULT_SIZE, w: DEFAULT_SIZE };
    }
    const dim = function (/** @type {any} */ v) { return typeof v === "number" && v > 0 ? v : DEFAULT_SIZE; };
    if (shape[3] === 3) return { name: name, layout: "NHWC", h: dim(shape[1]), w: dim(shape[2]) };
    if (shape[1] === 3) return { name: name, layout: "NCHW", h: dim(shape[2]), w: dim(shape[3]) };
    throw new Error("Unsupported input shape " + JSON.stringify(shape));
  }

  // ----- 전처리: ROI → Resize(INTER_AREA) → RGB → float32 / 255.0 -----

  /** @param {File} file */
  function decodeImage(file) {
    // 색공간 변환 없이 원본 픽셀 사용 (OpenCV imread와 동일하게), EXIF 방향은 반영
    return createImageBitmap(file, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
      imageOrientation: "from-image",
    }).catch(function (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
        userMessage: "이미지를 읽을 수 없습니다. 손상되지 않은 JPG, PNG, WEBP 파일을 사용해 주세요.",
      });
    });
  }

  /** @param {ImageBitmap} bitmap */
  function readPixels(bitmap) {
    const w = bitmap.width, h = bitmap.height;
    if (!w || !h || w * h > MAX_PIXELS) {
      throw Object.assign(new Error("image size " + w + "x" + h), {
        userMessage: "이미지 크기가 너무 크거나 올바르지 않습니다.",
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }

  /**
   * 축 하나에 대한 INTER_AREA 가중치 (dst 픽셀이 덮는 src 구간의 면적 비율)
   * @param {number} src @param {number} dst
   */
  function areaWeights(src, dst) {
    const scale = src / dst;
    /** @type {{ i: number[], w: number[] }[]} */
    const out = [];
    for (let d = 0; d < dst; d++) {
      const start = d * scale, end = start + scale;
      const i = [], wt = [];
      for (let s = Math.floor(start); s < Math.min(Math.ceil(end), src); s++) {
        const overlap = Math.min(end, s + 1) - Math.max(start, s);
        if (overlap > 1e-9) { i.push(s); wt.push(overlap / scale); }
      }
      out.push({ i: i, w: wt });
    }
    return out;
  }

  /**
   * 축 하나에 대한 가중치 — 원본이 160보다 작아 확대가 필요한 경우.
   * OpenCV INTER_AREA의 확대 모드 계수 계산식을 그대로 따름
   * @param {number} src @param {number} dst
   */
  function areaUpWeights(src, dst) {
    const scale = src / dst, inv = dst / src;
    /** @type {{ i: number[], w: number[] }[]} */
    const out = [];
    for (let d = 0; d < dst; d++) {
      let sx = Math.floor(d * scale);
      let fx = (d + 1) - (sx + 1) * inv;
      fx = fx <= 0 ? 0 : fx - Math.floor(fx);
      if (sx < 0) { sx = 0; fx = 0; }
      if (sx >= src - 1) { sx = src - 1; fx = 0; }
      out.push({ i: [sx, Math.min(sx + 1, src - 1)], w: [1 - fx, fx] });
    }
    return out;
  }

  /**
   * cv2.resize(roi, (w, h), interpolation=cv2.INTER_AREA)와 동일한 방식으로 축소한 뒤
   * uint8로 반올림하고 /255.0 정규화하여 모델 Layout에 맞는 Float32Array 생성
   * @param {ImageData} img
   * @param {{ layout: "NHWC" | "NCHW", h: number, w: number }} spec
   */
  function toTensorData(img, spec) {
    // Soil ROI crop (정수 픽셀 좌표)
    const rx0 = Math.round(ROI.x0 * img.width), ry0 = Math.round(ROI.y0 * img.height);
    const rw = Math.max(1, Math.round(ROI.x1 * img.width) - rx0);
    const rh = Math.max(1, Math.round(ROI.y1 * img.height) - ry0);

    // OpenCV는 가로·세로 모두 축소일 때만 면적 평균, 그 외에는 확대 모드 계수를 사용
    const shrink = rw >= spec.w && rh >= spec.h;
    const wx = shrink ? areaWeights(rw, spec.w) : areaUpWeights(rw, spec.w);
    const wy = shrink ? areaWeights(rh, spec.h) : areaUpWeights(rh, spec.h);

    const src = img.data, stride = img.width * 4;
    const plane = spec.h * spec.w;
    const out = new Float32Array(plane * 3);
    const row = new Float64Array(spec.w * 3);

    for (let y = 0; y < spec.h; y++) {
      row.fill(0);
      const ys = wy[y];
      for (let k = 0; k < ys.i.length; k++) {
        const base = (ry0 + ys.i[k]) * stride, wyk = ys.w[k];
        for (let x = 0; x < spec.w; x++) {
          const xs = wx[x];
          let r = 0, g = 0, b = 0;
          for (let j = 0; j < xs.i.length; j++) {
            const p = base + (rx0 + xs.i[j]) * 4, wj = xs.w[j];
            r += src[p] * wj; g += src[p + 1] * wj; b += src[p + 2] * wj; // ImageData는 이미 RGB 순서
          }
          row[x * 3] += r * wyk; row[x * 3 + 1] += g * wyk; row[x * 3 + 2] += b * wyk;
        }
      }
      for (let x = 0; x < spec.w; x++) {
        for (let c = 0; c < 3; c++) {
          const v = Math.min(255, Math.max(0, Math.round(row[x * 3 + c]))) / 255.0;
          const idx = spec.layout === "NHWC" ? (y * spec.w + x) * 3 + c : c * plane + y * spec.w + x;
          out[idx] = v;
        }
      }
    }
    return out;
  }

  /** @param {Float32Array} values */
  function toProbabilities(values) {
    const arr = Array.from(values);
    const sum = arr.reduce(function (a, b) { return a + b; }, 0);
    const isProb = arr.every(function (v) { return v >= 0 && v <= 1; }) && Math.abs(sum - 1) < 1e-3;
    if (isProb) return arr;
    const max = Math.max.apply(null, arr); // 모델 출력이 logits인 경우 대비
    const exps = arr.map(function (v) { return Math.exp(v - max); });
    const total = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (v) { return v / total; });
  }

  // ----- 추론 -----
  let runId = 0;
  /** @type {string | null} */
  let previewUrl = null;

  /** @param {File} file */
  function isAccepted(file) {
    return ACCEPT_TYPES.indexOf(file.type) !== -1 || (!file.type && ACCEPT_EXT.test(file.name));
  }

  /** @param {File | undefined} file */
  function handleFile(file) {
    if (!file) return;
    const id = ++runId; // 새 이미지가 들어오면 이전 결과/진행 중 추론을 무효화

    if (!isAccepted(file)) {
      showError("JPG, JPEG, PNG, WEBP 이미지 파일만 사용할 수 있습니다.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImg.src = previewUrl;
    previewView.hidden = false;
    emptyView.hidden = true;
    drop.classList.add("has-image");
    setState("loading");

    Promise.all([getSession(), decodeImage(file)])
      .then(function ([session, bitmap]) {
        const ort = /** @type {any} */ (window).ort;
        const spec = resolveInput(session);
        const pixels = readPixels(bitmap);
        bitmap.close();
        const data = toTensorData(pixels, spec);
        const dims = spec.layout === "NHWC" ? [1, spec.h, spec.w, 3] : [1, 3, spec.h, spec.w];
        const feeds = /** @type {Record<string, any>} */ ({});
        feeds[spec.name] = new ort.Tensor("float32", data, dims);
        return session.run(feeds).then(function (/** @type {any} */ outputs) {
          return outputs[session.outputNames[0]].data;
        }).catch(function (/** @type {any} */ err) {
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
            userMessage: "추론 중 오류가 발생했습니다. 다른 이미지로 다시 시도해 주세요.",
          });
        });
      })
      .then(function (raw) {
        if (id !== runId) return;
        const probs = toProbabilities(raw);
        let best = 0;
        for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
        console.info("[SPOT AI] prediction", Object.fromEntries(CLASSES.map(function (c, i) { return [c, probs[i]]; })));
        resultClass.textContent = CLASSES[best] || "Class " + best;
        resultDot.className = "pp-dot " + (CLASS_DOT[best] || "");
        resultConf.textContent = (probs[best] * 100).toFixed(2) + "%";
        setState("success");
      })
      .catch(function (err) {
        if (id !== runId) return;
        console.error("[SPOT AI] inference failed:", err);
        showError((err && err.userMessage) || "이미지를 처리하지 못했습니다. 다시 시도해 주세요.");
      });
  }

  // ----- Upload 버튼 / File Picker -----
  root.querySelectorAll("[data-pick]").forEach(function (btn) {
    btn.addEventListener("click", function () { fileInput.click(); });
  });
  fileInput.addEventListener("change", function () {
    handleFile(fileInput.files ? fileInput.files[0] : undefined);
    fileInput.value = ""; // 같은 파일을 다시 선택해도 change 이벤트 발생
  });

  // ----- Drag & Drop -----
  let dragDepth = 0;
  /** @param {DragEvent} e */
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types).indexOf("Files") !== -1;

  drop.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    drop.classList.add("is-dragover");
  });
  drop.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  drop.addEventListener("dragleave", function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove("is-dragover");
  });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    dragDepth = 0;
    drop.classList.remove("is-dragover");
    handleFile(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : undefined);
  });

  // Drop Zone 밖에 파일을 놓쳤을 때 브라우저가 페이지를 떠나 이미지를 여는 것 방지
  window.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", function (e) { if (hasFiles(e)) e.preventDefault(); });
})();
