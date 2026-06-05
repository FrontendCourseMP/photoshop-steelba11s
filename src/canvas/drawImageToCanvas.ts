import { DecodedImage } from "../formats/gb7Decoder";
import { setCanvasResolution } from "./canvasUtils";

export function drawImageToCanvas(
  canvas: HTMLCanvasElement,
  image: DecodedImage
): void {
  const ctx = setCanvasResolution(canvas, image.width, image.height);

  if (!ctx) {
    throw new Error("Не удалось получить контекст рисования");
  }

  const imageData = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height
  );
  ctx.putImageData(imageData, 0, 0);
}
