"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const SIZE = 1080;
const SLOT = { x: 0, y: 106, w: 1080, h: 759 };

type EditorState = {
  x: number;
  y: number;
  scale: number;
  fitScale: number;
  rotation: number;
  brightness: number;
  contrast: number;
  flipX: boolean;
};

type TextLayer = {
  id: number;
  value: string;
  x: number;
  y: number;
  size: number;
  color: string;
  weight: number;
};

function measureTextBlock(ctx: CanvasRenderingContext2D, text: TextLayer) {
  const lines = text.value.split(/\r?\n/);
  const lineHeight = text.size * 1.2;
  const width = Math.max(
    text.size * 0.25,
    ...lines.map((line) => ctx.measureText(line).width),
  );
  return { lines, lineHeight, width, height: lines.length * lineHeight };
}

const INITIAL_STATE: EditorState = {
  x: SLOT.x + SLOT.w / 2,
  y: SLOT.y + SLOT.h / 2,
  scale: 1,
  fitScale: 1,
  rotation: 0,
  brightness: 1,
  contrast: 1,
  flipX: false,
};

function containScale(image: HTMLImageElement) {
  return Math.min(SLOT.w / image.width, SLOT.h / image.height);
}

function scaleFor(
  image: HTMLImageElement,
  rotation: number,
  mode: "contain" | "cover",
) {
  const rad = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const boxW = image.width * c + image.height * s;
  const boxH = image.width * s + image.height * c;
  const contain = Math.min(SLOT.w / boxW, SLOT.h / boxH);
  const cover = Math.max(SLOT.w / boxW, SLOT.h / boxH);
  return mode === "cover" ? cover : contain;
}

const MIN_SIZE_PERCENT = 1;
const MAX_SIZE_PERCENT = 8000;
const SIZE_SLIDER_STEPS = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value: number) {
  const rounded = Math.round(value * 10) / 10;
  const negative = rounded < 0;
  let wrapped = ((rounded % 360) + 360) % 360;
  if (wrapped === 0) return 0;
  if (wrapped === 180) return negative ? -180 : 180;
  if (wrapped > 180) wrapped -= 360;
  return Math.round(wrapped * 10) / 10;
}

function formatDegrees(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function clampScale(scale: number, fitScale: number) {
  return clamp(
    scale,
    fitScale * (MIN_SIZE_PERCENT / 100),
    fitScale * (MAX_SIZE_PERCENT / 100),
  );
}

function sizePercentToSlider(percent: number) {
  const safe = clamp(percent, MIN_SIZE_PERCENT, MAX_SIZE_PERCENT);
  const logMin = Math.log(MIN_SIZE_PERCENT);
  const logMax = Math.log(MAX_SIZE_PERCENT);
  return ((Math.log(safe) - logMin) / (logMax - logMin)) * SIZE_SLIDER_STEPS;
}

function sliderToSizePercent(slider: number) {
  const t = clamp(slider / SIZE_SLIDER_STEPS, 0, 1);
  const logMin = Math.log(MIN_SIZE_PERCENT);
  const logMax = Math.log(MAX_SIZE_PERCENT);
  return Math.exp(logMin + t * (logMax - logMin));
}

function pastedImage(data: DataTransfer | null) {
  if (!data) return null;
  const fromFiles = [...data.files].find((file) => file.type.startsWith("image/"));
  if (fromFiles) return fromFiles;
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

function withPasteName(file: File) {
  if (file.name.trim()) return file;
  const kind = (file.type.split("/")[1] ?? "png").split("+")[0];
  const ext = kind === "jpeg" ? "jpg" : kind || "png";
  return new File([file], `tempelan.${ext}`, { type: file.type || "image/png" });
}

function zoomAt(
  current: EditorState,
  nextScale: number,
  originX: number,
  originY: number,
) {
  const scale = clampScale(nextScale, current.fitScale);
  if (scale === current.scale) return current;
  const ratio = scale / current.scale;
  return {
    ...current,
    scale,
    x: originX - (originX - current.x) * ratio,
    y: originY - (originY - current.y) * ratio,
  };
}

function paint(
  ctx: CanvasRenderingContext2D,
  template: HTMLImageElement,
  photo: HTMLImageElement | null,
  state: EditorState,
  texts: TextLayer[],
  fontFamily: string,
) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(template, 0, 0, SIZE, SIZE);

  if (photo) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(SLOT.x, SLOT.y, SLOT.w, SLOT.h);
    ctx.clip();
    ctx.filter = `brightness(${state.brightness}) contrast(${state.contrast})`;
    ctx.translate(state.x, state.y);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.flipX ? -1 : 1, 1);
    const width = photo.width * state.scale;
    const height = photo.height * state.scale;
    ctx.drawImage(photo, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  for (const text of texts) {
    ctx.save();
    ctx.font = `${text.weight} ${text.size}px ${fontFamily}`;
    ctx.fillStyle = text.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const { lines, lineHeight } = measureTextBlock(ctx, text);
    lines.forEach((line, index) => {
      ctx.fillText(
        line,
        text.x,
        text.y + (index - (lines.length - 1) / 2) * lineHeight,
      );
    });
    ctx.restore();
  }
}

const HANDLE = 36;
const RESIZE_HANDLES = [
  { signX: -1, signY: -1 },
  { signX: 1, signY: -1 },
  { signX: 1, signY: 1 },
  { signX: -1, signY: 1 },
  { signX: 0, signY: -1 },
  { signX: 1, signY: 0 },
  { signX: 0, signY: 1 },
  { signX: -1, signY: 0 },
];

type ResizeDrag = {
  type: "resize";
  signX: number;
  signY: number;
  anchorX: number;
  anchorY: number;
  grabScale: number;
  grabAlong: number;
};

type DragGesture =
  | { type: "move"; x: number; y: number }
  | { type: "move-text"; id: number; x: number; y: number }
  | ResizeDrag;

function localToCanvasOffset(lx: number, ly: number, rotation: number, flipX: boolean) {
  const fx = flipX ? -lx : lx;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: fx * cos - ly * sin, y: fx * sin + ly * cos };
}

function canvasToLocal(point: { x: number; y: number }, state: EditorState) {
  const dx = point.x - state.x;
  const dy = point.y - state.y;
  const rad = (state.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const fx = dx * cos + dy * sin;
  const fy = -dx * sin + dy * cos;
  return { x: state.flipX ? -fx : fx, y: fy };
}

function canvasVectorToLocal(dx: number, dy: number, rotation: number, flipX: boolean) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const fx = dx * cos + dy * sin;
  const fy = -dx * sin + dy * cos;
  return { x: flipX ? -fx : fx, y: fy };
}

function resizeCursor(signX: number, signY: number, state: EditorState) {
  const vector = localToCanvasOffset(signX, signY, state.rotation, state.flipX);
  const deg = ((Math.atan2(vector.y, vector.x) * 180) / Math.PI + 360) % 180;
  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nwse-resize";
  if (deg < 112.5) return "ns-resize";
  return "nesw-resize";
}

function findResizeHandle(
  point: { x: number; y: number },
  photo: HTMLImageElement,
  state: EditorState,
  hit: number,
) {
  const halfW = (photo.width * state.scale) / 2;
  const halfH = (photo.height * state.scale) / 2;
  const local = canvasToLocal(point, state);
  const nearX = Math.abs(Math.abs(local.x) - halfW) <= hit && Math.abs(local.y) <= halfH + hit;
  const nearY = Math.abs(Math.abs(local.y) - halfH) <= hit && Math.abs(local.x) <= halfW + hit;
  if (!nearX && !nearY) return null;

  const signX = nearX ? Math.sign(local.x) || 1 : 0;
  const signY = nearY ? Math.sign(local.y) || 1 : 0;
  const offset = localToCanvasOffset(-signX * halfW, -signY * halfH, state.rotation, state.flipX);
  return {
    signX,
    signY,
    anchorX: state.x + offset.x,
    anchorY: state.y + offset.y,
  };
}

function resizedState(
  point: { x: number; y: number },
  drag: ResizeDrag,
  photo: HTMLImageElement,
  state: EditorState,
) {
  const rel = canvasVectorToLocal(
    point.x - drag.anchorX,
    point.y - drag.anchorY,
    state.rotation,
    state.flipX,
  );
  const along = Math.hypot(drag.signX ? rel.x : 0, drag.signY ? rel.y : 0);
  const dot = (drag.signX ? rel.x * drag.signX : 0) + (drag.signY ? rel.y * drag.signY : 0);
  const raw = dot <= 0 ? 0 : drag.grabScale * (along / drag.grabAlong);
  const scale = clampScale(raw, state.fitScale);
  const offset = localToCanvasOffset(
    -drag.signX * photo.width * scale * 0.5,
    -drag.signY * photo.height * scale * 0.5,
    state.rotation,
    state.flipX,
  );
  return {
    ...state,
    scale,
    x: drag.anchorX - offset.x,
    y: drag.anchorY - offset.y,
  };
}

function paintGuide(
  ctx: CanvasRenderingContext2D,
  photo: HTMLImageElement | null,
  state: EditorState,
  texts: TextLayer[],
  selectedTextId: number | null,
  fontFamily: string,
) {
  ctx.clearRect(0, 0, SIZE, SIZE);
  if (photo) {
    const width = photo.width * state.scale;
    const height = photo.height * state.scale;
    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.flipX ? -1 : 1, 1);
    ctx.strokeStyle = "rgba(255, 248, 240, 0.92)";
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 12]);
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff8f0";
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 5;
    for (const handle of RESIZE_HANDLES) {
      const x = handle.signX * width * 0.5;
      const y = handle.signY * height * 0.5;
      ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
    }
    ctx.restore();
  }

  const selectedText = texts.find((text) => text.id === selectedTextId);
  if (selectedText) {
    ctx.save();
    ctx.font = `${selectedText.weight} ${selectedText.size}px ${fontFamily}`;
    const { width, height } = measureTextBlock(ctx, selectedText);
    ctx.strokeStyle = "rgba(232, 184, 74, 0.95)";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(
      selectedText.x - width / 2 - 8,
      selectedText.y - height / 2 - 8,
      width + 16,
      height + 16,
    );
    ctx.restore();
  }
}

export function PhotoEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const guideRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLImageElement | null>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const dragRef = useRef<DragGesture | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; x: number; y: number } | null>(null);
  const stateRef = useRef<EditorState>(INITIAL_STATE);
  const loadFileRef = useRef<(file: File) => void>(() => {});
  const nextTextIdRef = useRef(1);

  const [ready, setReady] = useState(false);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoToken, setPhotoToken] = useState(0);
  const [state, setState] = useState<EditorState>(INITIAL_STATE);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);

  stateRef.current = state;

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      templateRef.current = image;
      setReady(true);
    };
    image.onerror = () => setError("Template tidak bisa dimuat.");
    image.src = "/Template.jpeg";
  }, []);

  useEffect(() => {
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const template = templateRef.current;
    if (!canvas || !template) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    paint(ctx, template, photoRef.current, state, texts, fontFamily);

    const guide = guideRef.current;
    const guideCtx = guide?.getContext("2d");
    if (guideCtx) {
      paintGuide(guideCtx, photoRef.current, state, texts, selectedTextId, fontFamily);
    }
  }, [state, ready, photoToken, texts, selectedTextId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent) => {
      if (!photoRef.current) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pointerX = ((event.clientX - rect.left) / rect.width) * SIZE;
      const pointerY = ((event.clientY - rect.top) / rect.height) * SIZE;
      const factor = event.deltaY < 0 ? 1.06 : 1 / 1.06;
      const current = stateRef.current;
      const next = zoomAt(current, current.scale * factor, pointerX, pointerY);
      stateRef.current = next;
      setState(next);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [ready]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }
      if (!photoRef.current && selectedTextId === null) return;
      const step = event.shiftKey ? 20 : 4;
      const selectedText = texts.find((text) => text.id === selectedTextId);
      if (selectedText) {
        const offsets: Record<string, { x: number; y: number }> = {
          ArrowLeft: { x: -step, y: 0 },
          ArrowRight: { x: step, y: 0 },
          ArrowUp: { x: 0, y: -step },
          ArrowDown: { x: 0, y: step },
        };
        const offset = offsets[event.key];
        if (offset) {
          event.preventDefault();
          setTexts((current) =>
            current.map((text) =>
              text.id === selectedTextId
                ? { ...text, x: text.x + offset.x, y: text.y + offset.y }
                : text,
            ),
          );
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setState((current) => ({ ...current, x: current.x - step }));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setState((current) => ({ ...current, x: current.x + step }));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setState((current) => ({ ...current, y: current.y - step }));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setState((current) => ({ ...current, y: current.y + step }));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTextId, texts]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (
        target instanceof HTMLInputElement &&
        target.type !== "range" &&
        target.type !== "file"
      ) {
        return;
      }

      const file = pastedImage(event.clipboardData);
      if (!file) {
        setError("Clipboard tidak berisi gambar. Salin foto dulu, lalu tekan Ctrl+V.");
        return;
      }

      event.preventDefault();
      loadFileRef.current(withPasteName(file));
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function loadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("File itu bukan gambar.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = url;
      photoRef.current = image;
      const fit = containScale(image);
      setPhotoName(file.name);
      setError(null);
      setPhotoToken((token) => token + 1);
      setState({
        ...INITIAL_STATE,
        x: SLOT.x + SLOT.w / 2,
        y: SLOT.y + SLOT.h / 2,
        scale: fit,
        fitScale: fit,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Format gambar tidak didukung browser ini.");
    };
    image.src = url;
  }

  loadFileRef.current = loadFile;

  function pointerToCanvas(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * SIZE,
      y: ((event.clientY - rect.top) / rect.height) * SIZE,
    };
  }

  function trackPointer(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerToCanvas(event);
    pointersRef.current.set(event.pointerId, point);
    return point;
  }

  function pinchGesture() {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    const [a, b] = points;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance <= 0) return null;
    return { distance, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function hitFor(canvas: HTMLCanvasElement) {
    const width = canvas.getBoundingClientRect().width || SIZE;
    return Math.max(HANDLE * 0.65, (18 / width) * SIZE);
  }

  function updateCursor(
    canvas: HTMLCanvasElement,
    point: { x: number; y: number } | null,
    dragging: DragGesture | null,
  ) {
    const photo = photoRef.current;
    if (dragging?.type === "move-text") {
      canvas.style.cursor = "grabbing";
      return;
    }
    if (!photo) {
      canvas.style.cursor = "pointer";
      return;
    }
    if (dragging?.type === "move") {
      canvas.style.cursor = "grabbing";
      return;
    }
    if (dragging?.type === "resize") {
      canvas.style.cursor = resizeCursor(dragging.signX, dragging.signY, stateRef.current);
      return;
    }
    const handle =
      point && findResizeHandle(point, photo, stateRef.current, hitFor(canvas));
    canvas.style.cursor = handle
      ? resizeCursor(handle.signX, handle.signY, stateRef.current)
      : "grab";
  }

  function addText() {
    const id = nextTextIdRef.current++;
    setTexts((current) => [
      ...current,
      {
        id,
        value: "Teks baru",
        x: SLOT.x + SLOT.w / 2,
        y: SLOT.y + SLOT.h / 2,
        size: 64,
        color: "#ffffff",
        weight: 700,
      },
    ]);
    setSelectedTextId(id);
  }

  function updateText(id: number, changes: Partial<Omit<TextLayer, "id">>) {
    setTexts((current) =>
      current.map((text) => (text.id === id ? { ...text, ...changes } : text)),
    );
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!photoRef.current && texts.length === 0) {
      fileRef.current?.click();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = trackPointer(event);
    const pinch = pinchGesture();
    if (pinch && photoRef.current) {
      pinchRef.current = pinch;
      dragRef.current = null;
      updateCursor(event.currentTarget, point, null);
      return;
    }
    const ctx = event.currentTarget.getContext("2d");
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const hitText = ctx
      ? [...texts].reverse().find((text) => {
          ctx.font = `${text.weight} ${text.size}px ${fontFamily}`;
          const { width, height } = measureTextBlock(ctx, text);
          return (
            Math.abs(point.x - text.x) <= width / 2 + 8 &&
            Math.abs(point.y - text.y) <= height / 2 + 8
          );
        })
      : undefined;
    if (hitText) {
      setSelectedTextId(hitText.id);
      dragRef.current = { type: "move-text", id: hitText.id, x: point.x, y: point.y };
      updateCursor(event.currentTarget, point, dragRef.current);
      return;
    }
    setSelectedTextId(null);
    if (!photoRef.current) {
      dragRef.current = null;
      return;
    }
    const current = stateRef.current;
    const handle = findResizeHandle(point, photoRef.current, current, hitFor(event.currentTarget));
    if (handle) {
      const rel = canvasVectorToLocal(
        point.x - handle.anchorX,
        point.y - handle.anchorY,
        current.rotation,
        current.flipX,
      );
      const along = Math.hypot(handle.signX ? rel.x : 0, handle.signY ? rel.y : 0);
      dragRef.current = {
        type: "resize",
        ...handle,
        grabScale: current.scale,
        grabAlong: Math.max(along, 1),
      };
    } else {
      dragRef.current = { type: "move", x: point.x, y: point.y };
    }
    updateCursor(event.currentTarget, point, dragRef.current);
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const point = pointerToCanvas(event);
    if (!pointersRef.current.has(event.pointerId)) {
      updateCursor(event.currentTarget, point, dragRef.current);
      return;
    }
    trackPointer(event);
    const pinchNow = pinchGesture();
    const pinchPrev = pinchRef.current;
    if (pinchNow && pinchPrev) {
      const current = stateRef.current;
      const next = zoomAt(
        current,
        current.scale * (pinchNow.distance / pinchPrev.distance),
        pinchNow.x,
        pinchNow.y,
      );
      stateRef.current = next;
      setState(next);
      pinchRef.current = pinchNow;
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.type === "move-text") {
      const dx = point.x - drag.x;
      const dy = point.y - drag.y;
      dragRef.current = { ...drag, x: point.x, y: point.y };
      updateText(drag.id, {
        x: (texts.find((text) => text.id === drag.id)?.x ?? point.x) + dx,
        y: (texts.find((text) => text.id === drag.id)?.y ?? point.y) + dy,
      });
      updateCursor(event.currentTarget, point, dragRef.current);
      return;
    }
    if (drag.type === "resize") {
      const photo = photoRef.current;
      if (!photo) return;
      const next = resizedState(point, drag, photo, stateRef.current);
      stateRef.current = next;
      setState(next);
      updateCursor(event.currentTarget, point, drag);
      return;
    }
    const dx = point.x - drag.x;
    const dy = point.y - drag.y;
    dragRef.current = { type: "move", x: point.x, y: point.y };
    setState((current) => {
      const next = { ...current, x: current.x + dx, y: current.y + dy };
      stateRef.current = next;
      return next;
    });
    updateCursor(event.currentTarget, point, dragRef.current);
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(event.pointerId);
    const pinch = pinchGesture();
    pinchRef.current = pinch;
    if (pointersRef.current.size === 1) {
      const point = [...pointersRef.current.values()][0];
      dragRef.current = { type: "move", x: point.x, y: point.y };
      return;
    }
    dragRef.current = null;
    updateCursor(event.currentTarget, pointerToCanvas(event), null);
  }

  function onPointerLeave(event: PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current) return;
    event.currentTarget.style.cursor = photoRef.current ? "grab" : "pointer";
  }

  function place(mode: "contain" | "cover") {
    const photo = photoRef.current;
    if (!photo) return;
    setState((current) => ({
      ...current,
      x: SLOT.x + SLOT.w / 2,
      y: SLOT.y + SLOT.h / 2,
      scale: scaleFor(photo, current.rotation, mode),
    }));
  }

  function resetAdjustments() {
    const photo = photoRef.current;
    if (!photo) return;
    const fit = containScale(photo);
    setState({
      ...INITIAL_STATE,
      x: SLOT.x + SLOT.w / 2,
      y: SLOT.y + SLOT.h / 2,
      scale: fit,
      fitScale: fit,
    });
  }

  function download() {
    const canvas = canvasRef.current;
    if (!canvas || (!photoRef.current && texts.length === 0)) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Hasil belum bisa diunduh.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "hasil-edit.jpg";
        link.click();
        URL.revokeObjectURL(url);
      },
      "image/jpeg",
      0.95,
    );
  }

  const hasPhoto = photoName !== null;
  const selectedText = texts.find((text) => text.id === selectedTextId);
  const sizePercent = state.fitScale > 0 ? (state.scale / state.fitScale) * 100 : 100;

  return (
    <div className="flex flex-1 flex-col bg-[#121214] text-zinc-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#d31f26] text-white shadow-lg shadow-red-950/40">
              <ImageIcon />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Studio Edit Foto</h1>
              <p className="text-sm text-zinc-400">
                Atur foto dan tambahkan teks di atas template, lalu unduh hasilnya.
              </p>
            </div>
          </div>
          <p className="hidden text-right text-xs leading-5 text-zinc-500 sm:block">
            Hasil unduhan
            <br />
            1080 × 1080 px
          </p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div
            className={`relative mx-auto w-full max-w-[min(100%,calc(100vh-9rem))] overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/40 ring-1 ${
              draggingFile ? "ring-[#e8b84a]" : "ring-white/10"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDraggingFile(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDraggingFile(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDraggingFile(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDraggingFile(false);
              const file = event.dataTransfer.files?.[0];
              if (file) loadFile(file);
            }}
          >
            <canvas
              ref={canvasRef}
              width={SIZE}
              height={SIZE}
              className="block h-auto w-full touch-none"
              aria-label="Pratinjau foto di atas template"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerLeave}
            />
            <canvas
              ref={guideRef}
              width={SIZE}
              height={SIZE}
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden
            />
            {!hasPhoto && ready && (
              <div
                className="pointer-events-none absolute inset-x-0 flex items-center justify-center p-6"
                style={{ top: "9.8%", height: "70.3%" }}
              >
                <div
                  className={`flex max-w-xs flex-col items-center rounded-2xl border border-dashed px-6 py-8 text-center ${
                    draggingFile
                      ? "border-[#e8b84a] bg-black/35 text-white"
                      : "border-zinc-400/80 bg-white/70 text-zinc-700"
                  }`}
                >
                  <p className="text-base font-medium">
                    {draggingFile ? "Lepaskan foto di sini" : "Letakkan foto di area ini"}
                  </p>
                  <p className="mt-1 text-sm opacity-80">
                    Klik bidang, unggah, seret, atau tekan Ctrl+V.
                  </p>
                </div>
              </div>
            )}
            {!ready && (
              <div className="absolute inset-0 grid place-items-center bg-[#121214] text-sm text-zinc-400">
                Memuat template…
              </div>
            )}
          </div>
          <p className="mx-auto mt-3 max-w-[min(100%,calc(100vh-9rem))] text-center text-xs text-zinc-500">
            Seret foto atau teks pada kanvas untuk memindahkannya. Titik di tepi foto mengubah ukurannya. Garis bantu tidak ikut terunduh.
          </p>
        </section>

        <aside className="flex h-fit flex-col gap-5 rounded-2xl border border-white/10 bg-zinc-900/80 p-4 lg:sticky lg:top-6">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Foto</h2>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {photoName ?? "Belum ada foto"}
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-3 h-11 w-full rounded-xl bg-white text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
            >
              {hasPhoto ? "Ganti foto" : "Unggah foto"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadFile(file);
                event.target.value = "";
              }}
            />
          </div>

          <div className="border-t border-white/10 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Teks</h2>
              <button
                type="button"
                onClick={addText}
                disabled={!ready}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-600"
              >
                + Tambah teks
              </button>
            </div>
            {texts.length > 0 && (
              <div className="mb-3 grid gap-1">
                {texts.map((text, index) => (
                  <button
                    key={text.id}
                    type="button"
                    onClick={() => setSelectedTextId(text.id)}
                    className={`truncate rounded-lg px-3 py-2 text-left text-xs transition ${
                      text.id === selectedTextId
                        ? "bg-[#d31f26]/20 text-white"
                        : "bg-black/20 text-zinc-400 hover:bg-white/5"
                    }`}
                  >
                    {text.value || `Teks ${index + 1}`}
                  </button>
                ))}
              </div>
            )}
            {selectedText ? (
              <div className="grid gap-3">
                <label className="block text-xs text-zinc-400">
                  Isi teks
                  <textarea
                    rows={3}
                    value={selectedText.value}
                    onChange={(event) =>
                      updateText(selectedText.id, { value: event.target.value })
                    }
                    className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-[#e8b84a]"
                  />
                </label>
                <Slider
                  label="Ukuran teks"
                  min={16}
                  max={180}
                  step={1}
                  value={selectedText.size}
                  display={`${selectedText.size} px`}
                  disabled={false}
                  onChange={(size) => updateText(selectedText.id, { size })}
                />
                <label className="flex items-center justify-between text-xs text-zinc-400">
                  Warna teks
                  <input
                    type="color"
                    value={selectedText.color}
                    onChange={(event) =>
                      updateText(selectedText.id, { color: event.target.value })
                    }
                    aria-label="Warna teks"
                    className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent"
                  />
                </label>
                <label className="block text-xs text-zinc-400">
                  Ketebalan
                  <select
                    value={selectedText.weight}
                    onChange={(event) =>
                      updateText(selectedText.id, { weight: Number(event.target.value) })
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-white/10 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-[#e8b84a]"
                  >
                    <option value={400}>Normal</option>
                    <option value={500}>Sedang</option>
                    <option value={700}>Tebal</option>
                    <option value={900}>Ekstra tebal</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setTexts((current) => current.filter((text) => text.id !== selectedText.id));
                    setSelectedTextId(null);
                  }}
                  className="h-9 rounded-lg text-xs text-red-300 transition hover:bg-red-950/40"
                >
                  Hapus teks
                </button>
              </div>
            ) : (
              <p className="text-xs leading-5 text-zinc-500">
                Tambahkan teks, lalu seret pada kanvas untuk mengatur posisinya.
              </p>
            )}
          </div>

          <Slider
            label="Ukuran"
            min={0}
            max={SIZE_SLIDER_STEPS}
            step={1}
            value={sizePercentToSlider(hasPhoto ? sizePercent : 100)}
            display={hasPhoto ? `${Math.round(sizePercent)}%` : "—"}
            disabled={!hasPhoto}
            onChange={(value) =>
              setState((current) => {
                const next = {
                  ...current,
                  scale: clampScale(
                    current.fitScale * (sliderToSizePercent(value) / 100),
                    current.fitScale,
                  ),
                };
                stateRef.current = next;
                return next;
              })
            }
          />
          <Slider
            label="Putar"
            min={-180}
            max={180}
            step={0.1}
            value={state.rotation}
            display={
              <DegreeField
                value={state.rotation}
                disabled={!hasPhoto}
                onCommit={(rotation) =>
                  setState((current) => {
                    const next = { ...current, rotation };
                    stateRef.current = next;
                    return next;
                  })
                }
              />
            }
            disabled={!hasPhoto}
            onChange={(rotation) =>
              setState((current) => {
                const next = { ...current, rotation };
                stateRef.current = next;
                return next;
              })
            }
          />
          <Slider
            label="Kecerahan"
            min={50}
            max={150}
            step={1}
            value={Math.round(state.brightness * 100)}
            display={hasPhoto ? `${Math.round(state.brightness * 100)}%` : "—"}
            disabled={!hasPhoto}
            onChange={(value) =>
              setState((current) => ({ ...current, brightness: value / 100 }))
            }
          />
          <Slider
            label="Kontras"
            min={50}
            max={150}
            step={1}
            value={Math.round(state.contrast * 100)}
            display={hasPhoto ? `${Math.round(state.contrast * 100)}%` : "—"}
            disabled={!hasPhoto}
            onChange={(value) =>
              setState((current) => ({ ...current, contrast: value / 100 }))
            }
          />

          <div className="grid grid-cols-2 gap-2">
            <ToolButton disabled={!hasPhoto} onClick={() => place("contain")}>
              Muat pas
            </ToolButton>
            <ToolButton disabled={!hasPhoto} onClick={() => place("cover")}>
              Penuhkan
            </ToolButton>
            <ToolButton
              disabled={!hasPhoto}
              onClick={() =>
                setState((current) => ({
                  ...current,
                  x: SLOT.x + SLOT.w / 2,
                  y: SLOT.y + SLOT.h / 2,
                }))
              }
            >
              Tengah
            </ToolButton>
            <ToolButton
              disabled={!hasPhoto}
              onClick={() => setState((current) => ({ ...current, flipX: !current.flipX }))}
            >
              Cermin
            </ToolButton>
          </div>

          {error && (
            <p className="rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</p>
          )}

          <div className="grid gap-2">
            <button
              type="button"
              onClick={download}
              disabled={!ready || (!hasPhoto && texts.length === 0)}
              className="h-11 rounded-xl bg-[#d31f26] text-sm font-semibold text-white transition hover:bg-[#b5161c] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              Unduh JPG
            </button>
            <button
              type="button"
              onClick={resetAdjustments}
              disabled={!hasPhoto}
              className="h-10 rounded-xl text-sm text-zinc-300 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:text-zinc-600"
            >
              Atur ulang
            </button>
          </div>

          <p className="text-xs leading-5 text-zinc-500">
            Ctrl+V menempelkan gambar yang sudah disalin. Tombol panah menggeser foto. Proses edit
            berjalan di browser, foto tidak dikirim ke server.
          </p>
        </aside>
      </main>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  disabled,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: ReactNode;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`block ${disabled ? "opacity-50" : ""}`}>
      <span className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="tabular-nums text-zinc-400">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer accent-[#e8b84a] disabled:cursor-not-allowed"
      />
    </label>
  );
}

function DegreeField({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);

  function commit(raw: string) {
    const parsed = Number(raw.trim().replace(",", "."));
    if (!Number.isFinite(parsed)) return false;
    onCommit(normalizeDegrees(parsed));
    return true;
  }

  if (disabled) return <span>—</span>;

  return (
    <span className="flex items-center gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        aria-label="Sudut putar dalam derajat"
        value={draft ?? formatDegrees(value)}
        onFocus={(event) => {
          setDraft(formatDegrees(value));
          event.currentTarget.select();
        }}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (/^-?\d+(?:[.,]\d+)?$/.test(raw.trim())) commit(raw);
        }}
        onBlur={(event) => {
          if (cancelRef.current) {
            cancelRef.current = false;
            setDraft(null);
            return;
          }
          commit(event.currentTarget.value);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            setDraft(null);
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            cancelRef.current = true;
            event.currentTarget.blur();
          }
        }}
        className="w-16 rounded-md border border-white/10 bg-black/40 px-1.5 py-0.5 text-right text-sm text-zinc-100 outline-none focus:border-[#e8b84a]"
      />
      <span>°</span>
    </span>
  );
}

function ToolButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-10 rounded-xl border border-white/10 bg-zinc-800 text-sm text-zinc-100 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

function ImageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.6" fill="currentColor" />
      <path d="M6 17l4.2-4.2a1 1 0 0 1 1.4 0L17 18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
