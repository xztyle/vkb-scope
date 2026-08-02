/**
 * Backdrop images for the blueprint.
 *
 * No manufacturer publishes a schematic of these devices, so the only reliable
 * picture is one the owner supplies — a photo of the device or the vendor's own
 * product render. Buttons are then mapped onto it.
 *
 * Images are downscaled before storing: a phone photo is several megabytes and
 * localStorage is a handful, so we keep a bounded-size copy instead.
 */

const KEY_PREFIX = "vkb-scope:image:";
const MAX_EDGE = 1400;
const QUALITY = 0.82;

export function loadImage(deviceKey: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + deviceKey);
  } catch {
    return null;
  }
}

export function saveImage(deviceKey: string, dataUrl: string): boolean {
  try {
    localStorage.setItem(KEY_PREFIX + deviceKey, dataUrl);
    return true;
  } catch {
    return false; // quota — the caller warns rather than failing silently
  }
}

export function clearImage(deviceKey: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + deviceKey);
  } catch {
    // ignore
  }
}

/** Shrink to a sane size and re-encode, so a 12MP photo doesn't blow the quota. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // PNG keeps transparency for renders; photos are far smaller as JPEG.
  const hasAlpha = file.type === "image/png" || file.type === "image/webp";
  return canvas.toDataURL(hasAlpha ? "image/png" : "image/jpeg", QUALITY);
}

export interface PickedImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export async function pickImage(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      downscale(file)
        .then((dataUrl) => measure(dataUrl))
        .then(resolve)
        .catch(() => resolve(null));
    });
    input.click();
  });
}

export function measure(dataUrl: string): Promise<PickedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = dataUrl;
  });
}
